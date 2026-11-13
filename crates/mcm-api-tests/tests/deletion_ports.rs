mod common;
use common::TestApp;
use serde_json::{Value, json};
use std::{collections::HashSet, error::Error, time::Duration};
type Result<T = ()> = std::result::Result<T, Box<dyn Error>>;
async fn create(app: &TestApp, body: Value) -> Result<Value> {
    let response = app.post("/api/v1/servers").json(&body).send().await?;
    assert_eq!(response.status(), 201);
    Ok(response.json::<Value>().await?["server"].clone())
}
async fn finished(app: &TestApp, response: reqwest::Response) -> Result<Value> {
    assert_eq!(response.status(), 202);
    let queued: Value = response.json().await?;
    let id = queued["job"]["id"].as_str().ok_or("job missing")?;
    for _ in 0..200 {
        let job: Value = app
            .client
            .get(format!("{}/api/v1/jobs/{id}", app.base))
            .send()
            .await?
            .json()
            .await?;
        if job["state"] == "succeeded" || job["state"] == "failed" {
            return Ok(job);
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    Err("job timed out".into())
}
fn remove(app: &TestApp, id: &str, query: &str) -> reqwest::RequestBuilder {
    app.client
        .delete(format!("{}/api/v1/servers/{id}{query}", app.base))
        .header("Origin", &app.base)
        .header("X-MCM-CSRF", "1")
}
#[tokio::test]
async fn concurrent_automatic_ports_are_unique_and_explicit_shared_ports_are_allowed() -> Result {
    let app = TestApp::with_auth(false).await?;
    let mut pending = Vec::new();
    for i in 0..8 {
        pending.push(
            app.post("/api/v1/servers")
                .json(&json!({"name":format!("Instance {i}")}))
                .send(),
        );
    }
    let responses = futures_util::future::join_all(pending).await;
    let mut ports = HashSet::new();
    for response in responses {
        let response = response?;
        assert_eq!(response.status(), 201);
        let server: Value = response.json().await?;
        ports.insert(server["server"]["port"].as_u64().ok_or("port")?);
    }
    assert_eq!(ports, (25565..25573).collect::<HashSet<_>>());
    assert_eq!(
        app.post("/api/v1/servers")
            .json(&json!({"name":"Explicit","port":25565}))
            .send()
            .await?
            .status(),
        201
    );
    let automatic = create(&app, json!({"name":"Null means automatic","port":null})).await?;
    assert_eq!(automatic["port"], 25573);
    let explicit = create(&app, json!({"name":"Explicit available","port":30000})).await?;
    assert_eq!(explicit["port"], 30000);
    app.close().await
}
#[tokio::test]
async fn default_deletion_retains_worlds_and_releases_the_managed_port() -> Result {
    let app = TestApp::with_auth(false).await?;
    let server = create(&app, json!({"name":"Retain"})).await?;
    let id = server["id"].as_str().ok_or("id")?;
    let directory = std::path::Path::new(server["directory"].as_str().ok_or("directory")?);
    tokio::fs::create_dir(directory.join("world")).await?;
    tokio::fs::write(directory.join("world/level.dat"), "world fixture").await?;
    let job = finished(&app, remove(&app, id, "").send().await?).await?;
    assert_eq!(job["state"], "succeeded");
    assert_eq!(job["result"]["deleted"]["id"], id);
    assert_eq!(job["result"]["deleted"]["filesDeleted"], false);
    assert_eq!(
        job["result"]["deleted"]["retainedDirectory"],
        directory.to_string_lossy().as_ref()
    );
    assert_eq!(
        tokio::fs::read_to_string(directory.join("world/level.dat")).await?,
        "world fixture"
    );
    assert_eq!(
        app.client
            .get(format!("{}/api/v1/servers/{id}", app.base))
            .send()
            .await?
            .status(),
        404
    );
    assert_eq!(remove(&app, id, "").send().await?.status(), 404);
    assert_eq!(
        create(&app, json!({"name":"Replacement"})).await?["port"],
        25565
    );
    app.close().await
}
#[tokio::test]
async fn explicit_file_deletion_removes_only_that_instance() -> Result {
    let app = TestApp::with_auth(false).await?;
    let first = create(&app, json!({"name":"Delete"})).await?;
    let other = create(&app, json!({"name":"Keep","port":25565})).await?;
    let id = first["id"].as_str().ok_or("id")?;
    let directory = std::path::Path::new(first["directory"].as_str().ok_or("directory")?);
    let outside = app.directory.path().join("outside-world");
    tokio::fs::create_dir(&outside).await?;
    tokio::fs::write(outside.join("level.dat"), "outside fixture").await?;
    #[cfg(unix)]
    std::os::unix::fs::symlink(&outside, directory.join("linked-world"))?;
    let job = finished(&app, remove(&app, id, "?deleteFiles=true").send().await?).await?;
    assert_eq!(job["state"], "succeeded");
    assert_eq!(job["result"]["deleted"]["filesDeleted"], true);
    assert!(job["result"]["deleted"]["retainedDirectory"].is_null());
    assert!(!directory.exists());
    assert!(std::path::Path::new(other["directory"].as_str().ok_or("other")?).is_dir());
    assert_eq!(
        create(
            &app,
            json!({"name":"Automatic after deleting a shared instance"})
        )
        .await?["port"],
        25566
    );
    assert_eq!(
        tokio::fs::read_to_string(outside.join("level.dat")).await?,
        "outside fixture"
    );
    app.close().await
}
#[tokio::test]
async fn running_instances_cannot_be_deleted_and_security_checks_still_apply() -> Result {
    let app = TestApp::with_auth(false).await?;
    let server = create(&app, json!({"name":"Running","acceptEula":true})).await?;
    let id = server["id"].as_str().ok_or("id")?;
    let directory = std::path::Path::new(server["directory"].as_str().ok_or("directory")?);
    tokio::fs::write(directory.join("server.jar"), "fixture").await?;
    assert_eq!(
        finished(
            &app,
            app.post(&format!("/api/v1/servers/{id}/start"))
                .send()
                .await?
        )
        .await?["state"],
        "succeeded"
    );
    let job = finished(&app, remove(&app, id, "?deleteFiles=true").send().await?).await?;
    assert_eq!(job["error"]["code"], "server.running");
    assert!(directory.join("server.jar").exists());
    assert_eq!(
        app.client
            .delete(format!("{}/api/v1/servers/{id}", app.base))
            .send()
            .await?
            .status(),
        403
    );
    for query in ["?deleteFiles=1", "?unknown=true"] {
        assert_eq!(remove(&app, id, query).send().await?.status(), 400);
    }
    assert_eq!(
        finished(
            &app,
            app.post(&format!("/api/v1/servers/{id}/stop"))
                .send()
                .await?
        )
        .await?["state"],
        "succeeded"
    );
    assert_eq!(
        finished(&app, remove(&app, id, "?deleteFiles=true").send().await?).await?["state"],
        "succeeded"
    );
    app.close().await
}
#[cfg(unix)]
#[tokio::test]
async fn a_replaced_instance_directory_cannot_redirect_deletion_outside_its_root() -> Result {
    let app = TestApp::with_auth(false).await?;
    let server = create(&app, json!({"name":"Symlink"})).await?;
    let id = server["id"].as_str().ok_or("id")?;
    let directory = std::path::Path::new(server["directory"].as_str().ok_or("directory")?);
    tokio::fs::remove_dir_all(directory).await?;
    let outside = app.directory.path().join("outside");
    tokio::fs::create_dir(&outside).await?;
    tokio::fs::write(outside.join("keep"), "keep").await?;
    std::os::unix::fs::symlink(&outside, directory)?;
    let job = finished(&app, remove(&app, id, "?deleteFiles=true").send().await?).await?;
    assert_eq!(job["error"]["code"], "internal");
    assert_eq!(
        tokio::fs::read_to_string(outside.join("keep")).await?,
        "keep"
    );
    assert_eq!(
        app.client
            .get(format!("{}/api/v1/servers/{id}", app.base))
            .send()
            .await?
            .status(),
        200
    );
    app.close().await
}

#[tokio::test]
async fn deletion_is_session_protected_when_auth_is_enabled() -> Result {
    let app = TestApp::new().await?;
    assert_eq!(remove(&app, "unknown", "").send().await?.status(), 503);
    app.setup().await?;
    let server = create(&app, json!({"name":"Protected"})).await?;
    let id = server["id"].as_str().ok_or("id")?;
    app.post("/api/v1/auth/logout")
        .send()
        .await?
        .error_for_status()?;
    assert_eq!(
        remove(&app, id, "?deleteFiles=true").send().await?.status(),
        401
    );
    assert!(std::path::Path::new(server["directory"].as_str().ok_or("directory")?).exists());
    app.close().await
}
#[tokio::test]
async fn unavailable_docker_preserves_record_and_files() -> Result {
    let directory = tempfile::tempdir()?;
    let mut config = mcm_config::Config {
        data_dir: directory.path().to_owned(),
        ..Default::default()
    };
    config.auth.enabled = false;
    config.docker.enabled = false;
    let backend = mcm_server::wiring::build_state(&config).await?;
    let server = backend
        .state
        .servers
        .create(serde_json::from_value(json!({"name":"Unavailable"}))?)
        .await?;
    assert!(matches!(
        backend.state.servers.delete(&server.server.id, true).await,
        Err(mcm_core::server::ServerError::DockerUnavailable)
    ));
    assert!(server.directory.join("eula.txt").exists());
    assert_eq!(
        backend
            .state
            .servers
            .get(&server.server.id)
            .await?
            .server
            .id,
        server.server.id
    );
    backend.shutdown().await;
    Ok(())
}

#[tokio::test]
async fn shared_ports_only_restrict_simultaneous_start_and_can_switch_instances() -> Result {
    let app = TestApp::with_auth(false).await?;
    let first = create(&app, json!({"name":"First","port":25565,"acceptEula":true})).await?;
    let second = create(
        &app,
        json!({"name":"Second","port":25565,"acceptEula":true}),
    )
    .await?;
    for server in [&first, &second] {
        tokio::fs::write(
            std::path::Path::new(server["directory"].as_str().ok_or("dir")?).join("server.jar"),
            "fixture",
        )
        .await?;
    }
    let a = first["id"].as_str().ok_or("id")?;
    let b = second["id"].as_str().ok_or("id")?;
    let (left, right) = tokio::join!(
        app.post(&format!("/api/v1/servers/{a}/start")).send(),
        app.post(&format!("/api/v1/servers/{b}/start")).send()
    );
    let left = finished(&app, left?).await?;
    let right = finished(&app, right?).await?;
    let (running, stopped) = if left["state"] == "succeeded" {
        assert_eq!(right["error"]["code"], "server.port_in_use");
        (a, b)
    } else {
        assert_eq!(left["error"]["code"], "server.port_in_use");
        assert_eq!(right["state"], "succeeded");
        (b, a)
    };
    assert_eq!(
        finished(
            &app,
            app.post(&format!("/api/v1/servers/{running}/stop"))
                .send()
                .await?
        )
        .await?["state"],
        "succeeded"
    );
    assert_eq!(
        finished(
            &app,
            app.post(&format!("/api/v1/servers/{stopped}/start"))
                .send()
                .await?
        )
        .await?["state"],
        "succeeded"
    );
    let restart = finished(
        &app,
        app.post(&format!("/api/v1/servers/{running}/restart"))
            .send()
            .await?,
    )
    .await?;
    assert_eq!(restart["error"]["code"], "server.port_in_use");
    app.close().await
}
