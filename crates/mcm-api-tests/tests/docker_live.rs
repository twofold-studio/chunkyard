//! Opt-in test: build testdata/docker-runtime first, then run with --ignored.
use futures_util::StreamExt;
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
async fn edited_resource_limits_recreate_container_preserving_files() -> Result {
    let directory = tempfile::tempdir()?;
    let mut config = mcm_config::Config {
        data_dir: directory.path().to_owned(),
        ..Default::default()
    };
    config.auth.enabled = false;
    config.docker.runtime_image = "mcm-manager-test-runtime:local".into();
    config.docker.publish_ip = [127, 0, 0, 1].into();
    config.docker.stop_timeout_s = 3;
    let backend = build_state(&config).await?;
    let socket = std::net::TcpListener::bind("127.0.0.1:0")?;
    let port = socket.local_addr()?.port();
    drop(socket);
    let instance=backend.state.servers.create(serde_json::from_value(json!({"name":"Resources fixture","port":port,"memoryMinMb":128,"memoryMaxMb":256,"acceptEula":true}))?).await?;
    let id = &instance.server.id;
    std::fs::write(instance.directory.join("server.jar"), "console fixture")?;
    std::fs::write(instance.directory.join("marker.txt"), "preserved")?;
    let manager = std::fs::read_to_string(directory.path().join("instance-id"))?;
    let cleanup = ContainerCleanup(format!("mcm-{manager}-{id}"));
    let first = backend.state.servers.start(id).await?;
    backend.state.servers.stop(id).await?;
    backend
        .state
        .servers
        .set_resources(
            id,
            mcm_core::server::ResourceUpdate {
                memory_min_mb: 128,
                memory_max_mb: 384,
                cpus: 0.5,
            },
        )
        .await?;
    assert_eq!(
        std::fs::read_to_string(instance.directory.join("marker.txt"))?,
        "preserved"
    );
    let next = backend.state.servers.start(id).await?;
    assert_ne!(first.status.container_id, next.status.container_id);
    let inspect = Command::new("docker")
        .args(["inspect", &cleanup.0])
        .output()?;
    assert!(inspect.status.success());
    let inspect: serde_json::Value = serde_json::from_slice(&inspect.stdout)?;
    assert_eq!(inspect[0]["HostConfig"]["NanoCpus"], 500_000_000);
    assert_eq!(
        inspect[0]["HostConfig"]["Memory"],
        (384 + 256) * 1024 * 1024
    );
    assert!(
        inspect[0]["Config"]["Cmd"]
            .as_array()
            .ok_or("command")?
            .contains(&json!("-Xmx384M"))
    );
    backend.state.servers.stop(id).await?;
    backend.state.servers.delete(id, true).await?;
    backend.shutdown().await;
    Ok(())
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
    config.docker.publish_ip = [127, 0, 0, 1].into();
    config.docker.runtime_image = std::env::var("CHUNKYARD_TEST_DOCKER_IMAGE")
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
    if let Ok(source) = std::env::var("CHUNKYARD_TEST_SERVER_JAR") {
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
    let shared = backend
        .state
        .servers
        .create(serde_json::from_value(json!({
            "name":"Shared port fixture", "port":port, "acceptEula":true,
            "memoryMinMb":128,"memoryMaxMb":256
        }))?)
        .await?;
    let shared_name = format!("mcm-{instance}-{}", shared.server.id);
    let _shared_cleanup = ContainerCleanup(shared_name);
    std::fs::copy(
        created.directory.join("server.jar"),
        shared.directory.join("server.jar"),
    )?;
    assert!(matches!(
        backend.state.servers.start(&shared.server.id).await,
        Err(mcm_core::server::ServerError::PortInUse)
    ));
    let paused = Command::new("docker")
        .args(["pause", &_cleanup.0])
        .output()?;
    assert!(paused.status.success());
    let paused_conflict = backend.state.servers.start(&shared.server.id).await;
    let unpaused = Command::new("docker")
        .args(["unpause", &_cleanup.0])
        .output()?;
    assert!(unpaused.status.success());
    assert!(matches!(
        paused_conflict,
        Err(mcm_core::server::ServerError::PortInUse)
    ));
    backend.state.servers.stop(&id).await?;
    assert_eq!(
        backend
            .state
            .servers
            .start(&shared.server.id)
            .await?
            .status
            .state,
        ServerState::Running
    );
    backend.state.servers.stop(&shared.server.id).await?;
    backend
        .state
        .servers
        .delete(&shared.server.id, true)
        .await?;
    assert!(!shared.directory.exists());
    backend.state.servers.start(&id).await?;
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
    let mut live = backend.state.servers.console_stream(&id).await?;
    tokio::time::timeout(Duration::from_secs(5), live.next())
        .await?
        .ok_or("missing console history")??;
    backend
        .state
        .servers
        .command(&id, "say live-stream-fixture")
        .await?;
    tokio::time::timeout(Duration::from_secs(5), async {
        while let Some(line) = live.next().await {
            if line?.text.contains("live-stream-fixture") {
                return Ok::<_, Box<dyn std::error::Error>>(());
            }
        }
        Err("console stream ended before command output".into())
    })
    .await??;
    drop(live);
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
    let active_properties = backend.state.properties.properties(&id).await?;
    let pending_content = format!(
        "{}motd=pending version fixture\n",
        active_properties.content
    );
    let pending_properties = backend
        .state
        .properties
        .save_properties(
            &id,
            mcm_core::properties::PropertiesWrite {
                content: pending_content.clone(),
                etag: active_properties.etag,
            },
        )
        .await?;
    assert!(pending_properties.restart_required);
    assert!(
        !std::fs::read_to_string(created.directory.join("server.properties"))?
            .contains("pending version fixture")
    );
    backend.shutdown().await;
    drop(backend);
    config.docker.publish_ip = [0, 0, 0, 0].into();
    let reopened = build_state(&config).await?;
    assert_eq!(
        reopened.state.servers.get(&id).await?.status.state,
        ServerState::Running
    );
    let old_id = reopened.state.servers.get(&id).await?.status.container_id;
    let old_network = reopened.state.servers.network(&id).await?;
    let persisted = reopened.state.properties.properties(&id).await?;
    assert_eq!(persisted.version, pending_properties.version);
    assert_ne!(persisted.applied_version, Some(persisted.version));
    assert_eq!(old_network.bound_publish_ip.as_deref(), Some("127.0.0.1"));
    assert!(old_network.restart_required);
    reopened.state.servers.restart(&id).await?;
    let applied_properties = reopened.state.properties.properties(&id).await?;
    assert_eq!(applied_properties.applied_version, Some(persisted.version));
    assert!(!applied_properties.restart_required);
    assert_eq!(
        std::fs::read_to_string(created.directory.join("server.properties"))?,
        pending_content
    );
    // A reused container can be restarted outside the manager. Its old applied
    // marker must not be claimed for this new process start.
    let external = Command::new("docker")
        .args(["restart", "--time", "1", &_cleanup.0])
        .output()?;
    assert!(external.status.success());
    let unknown = reopened.state.properties.properties(&id).await?;
    assert!(unknown.applied_version.is_none());
    assert!(unknown.restart_required);
    reopened.state.servers.restart(&id).await?;
    assert_eq!(
        reopened
            .state
            .properties
            .properties(&id)
            .await?
            .applied_version,
        Some(persisted.version)
    );
    let refreshed = reopened.state.servers.network(&id).await?;
    assert_eq!(refreshed.bound_publish_ip.as_deref(), Some("0.0.0.0"));
    assert!(!refreshed.restart_required);
    assert_ne!(refreshed.status.container_id, old_id);
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
    let deleted = reopened.state.servers.delete(&id, false).await?;
    assert!(!deleted.files_deleted);
    assert!(created.directory.join("starts.txt").exists());
    assert!(matches!(
        reopened.state.servers.get(&id).await,
        Err(mcm_core::server::ServerError::NotFound)
    ));
    assert!(
        !Command::new("docker")
            .args(["inspect", &_cleanup.0])
            .output()?
            .status
            .success()
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
    config.docker.runtime_image = std::env::var("CHUNKYARD_TEST_DOCKER_IMAGE")
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
    assert!(matches!(
        backend.state.servers.delete(&created.server.id, true).await,
        Err(mcm_core::server::ServerError::ContainerConflict)
    ));
    assert!(created.directory.join("server.jar").exists());
    assert!(matches!(
        backend.state.servers.get(&created.server.id).await,
        Err(mcm_core::server::ServerError::ContainerConflict)
    ));
    let output = Command::new("docker")
        .args(["inspect", "--format", "{{.State.Status}}", &name])
        .output()?;
    assert_eq!(String::from_utf8_lossy(&output.stdout).trim(), "created");
    backend.shutdown().await;
    Ok(())
}
