//! Opt-in test: build testdata/docker-runtime first, then run with --ignored.
use mcm_core::server::{CreateServer, ServerState};
use mcm_server::wiring::build_state;
use serde_json::json;
use std::{process::Command, time::Duration};
type Result<T = ()> = std::result::Result<T, Box<dyn std::error::Error>>;
struct ContainerCleanup(String);
impl Drop for ContainerCleanup {
    fn drop(&mut self) {
        let _ = Command::new("docker")
            .args(["rm", "--force", &self.0])
            .output();
    }
}
#[tokio::test]
#[ignore = "requires a Linux Docker engine and mcm-manager-test-runtime:local"]
async fn real_docker_start_console_restart_adoption_stop_and_kill() -> Result {
    let directory = tempfile::tempdir()?;
    let mut config = mcm_config::Config {
        data_dir: directory.path().to_owned(),
        ..Default::default()
    };
    config.auth.enabled = false;
    config.docker.runtime_image = std::env::var("MCM_TEST_DOCKER_IMAGE")
        .unwrap_or_else(|_| "mcm-manager-test-runtime:local".into());
    config.docker.stop_timeout_s = 3;
    let backend = build_state(&config).await?;
    assert!(backend.state.servers.runtime_info().await.available);
    let port_listener = std::net::TcpListener::bind("127.0.0.1:0")?;
    let port = port_listener.local_addr()?.port();
    drop(port_listener);
    let request: CreateServer = serde_json::from_value(
        json!({"name":"Docker fixture", "port":port, "acceptEula":true, "memoryMinMb":128, "memoryMaxMb":256}),
    )?;
    let created = backend.state.servers.create(request).await?;
    let id = created.server.id.clone();
    let instance = std::fs::read_to_string(directory.path().join("instance-id"))?;
    let _cleanup = ContainerCleanup(format!("mcm-{instance}-{id}"));
    if let Ok(source) = std::env::var("MCM_TEST_SERVER_JAR") {
        std::fs::copy(source, created.directory.join("server.jar"))?;
    } else {
        std::fs::write(
            created.directory.join("server.jar"),
            "fixture jar placeholder",
        )?;
    }
    let stopped_metrics = backend.state.servers.metrics(&id).await?;
    assert!(stopped_metrics.cpu_percent.is_none());
    let started = backend.state.servers.start(&id).await?;
    assert_eq!(started.status.state, ServerState::Running);
    for _ in 0..100 {
        if backend
            .state
            .servers
            .logs(&id, 100)
            .await?
            .iter()
            .any(|l| l.text.contains("Done"))
        {
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    assert!(
        backend
            .state
            .servers
            .logs(&id, 100)
            .await?
            .iter()
            .any(|l| l.text.contains("Done"))
    );
    let metrics = backend.state.servers.metrics(&id).await?;
    assert_eq!(metrics.status.state, ServerState::Running);
    assert!(metrics.uptime_seconds.is_some());
    assert!(metrics.memory_usage_bytes.is_some_and(|bytes| bytes > 0));
    assert!(metrics.memory_limit_bytes.is_some_and(|bytes| bytes > 0));
    assert!(
        metrics
            .cpu_percent
            .is_some_and(|percent| percent.is_finite() && percent >= 0.0)
    );
    assert!(metrics.pids.is_some_and(|pids| pids > 0));
    backend.state.servers.command(&id, "say hello").await?;
    for _ in 0..100 {
        if std::fs::read_to_string(created.directory.join("last-command.txt"))
            .is_ok_and(|s| s.trim() == "say hello")
        {
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    assert_eq!(
        std::fs::read_to_string(created.directory.join("last-command.txt"))?.trim(),
        "say hello"
    );
    backend.shutdown().await;
    drop(backend);
    let reopened = build_state(&config).await?;
    assert_eq!(
        reopened.state.servers.get(&id).await?.status.state,
        ServerState::Running
    );
    reopened.state.servers.restart(&id).await?;
    assert_eq!(
        reopened.state.servers.get(&id).await?.status.state,
        ServerState::Running
    );
    let stopped = reopened.state.servers.stop(&id).await?;
    assert_eq!(stopped.status.state, ServerState::Stopped);
    assert_eq!(stopped.status.exit_code, Some(0));
    reopened.state.servers.start(&id).await?;
    let killed = reopened.state.servers.kill(&id).await?;
    assert_eq!(killed.status.state, ServerState::Stopped);
    assert!(
        std::fs::read_to_string(created.directory.join("starts.txt"))?
            .lines()
            .count()
            >= 2
    );
    reopened.shutdown().await;
    Ok(())
}

#[tokio::test]
#[ignore = "requires a Linux Docker engine and the fixture image"]
async fn foreign_container_ownership_is_rejected_without_starting_it() -> Result {
    let directory = tempfile::tempdir()?;
    let mut config = mcm_config::Config {
        data_dir: directory.path().to_owned(),
        ..Default::default()
    };
    config.auth.enabled = false;
    config.docker.runtime_image = std::env::var("MCM_TEST_DOCKER_IMAGE")
        .unwrap_or_else(|_| "mcm-manager-test-runtime:local".into());
    let backend = build_state(&config).await?;
    let created = backend
        .state
        .servers
        .create(serde_json::from_value(
            json!({"name":"Ownership fixture", "port":25569, "acceptEula":true}),
        )?)
        .await?;
    std::fs::write(created.directory.join("server.jar"), "fixture")?;
    let instance = std::fs::read_to_string(directory.path().join("instance-id"))?;
    let name = format!("mcm-{instance}-{}", created.server.id);
    let _cleanup = ContainerCleanup(name.clone());
    let output = Command::new("docker")
        .args([
            "create",
            "--name",
            &name,
            "--label",
            "mcm.managed=true",
            "--label",
            "mcm.instance_id=another-manager",
            &config.docker.runtime_image,
        ])
        .output()?;
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(matches!(
        backend.state.servers.metrics(&created.server.id).await,
        Err(mcm_core::server::ServerError::ContainerConflict)
    ));
    assert!(matches!(
        backend.state.servers.start(&created.server.id).await,
        Err(mcm_core::server::ServerError::ContainerConflict)
    ));
    let output = Command::new("docker")
        .args(["inspect", "--format", "{{.State.Status}}", &name])
        .output()?;
    assert_eq!(String::from_utf8_lossy(&output.stdout).trim(), "created");
    backend.shutdown().await;
    Ok(())
}
