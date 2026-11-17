use crate::common::TestApp;
use serde_json::{Value, json};
type Result<T = ()> = std::result::Result<T, Box<dyn std::error::Error>>;
async fn create(app: &TestApp) -> Result<(String, std::path::PathBuf)> {
    let created: Value = app
        .post("/api/v1/servers")
        .json(&json!({"name":"Properties","acceptEula":true}))
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    let id = created["server"]["id"].as_str().ok_or("id")?.to_owned();
    let dir = created["server"]["directory"]
        .as_str()
        .ok_or("directory")?
        .into();
    Ok((id, dir))
}
async fn read(app: &TestApp, id: &str) -> Result<Value> {
    Ok(app
        .client
        .get(format!("{}/api/v1/servers/{id}/properties", app.base))
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?)
}
async fn save(app: &TestApp, id: &str, content: &str, etag: &Value) -> Result<Value> {
    Ok(app
        .client
        .put(format!("{}/api/v1/servers/{id}/properties", app.base))
        .header("Origin", &app.base)
        .header("X-MCM-CSRF", "1")
        .json(&json!({"content":content,"etag":etag}))
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?)
}
async fn action(app: &TestApp, id: &str, action: &str) -> Result {
    let response: Value = app
        .post(&format!("/api/v1/servers/{id}/{action}"))
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    let job = response["job"]["id"].as_str().ok_or("job")?;
    tokio::time::timeout(std::time::Duration::from_secs(10), async {
        loop {
            let job: Value = app
                .client
                .get(format!("{}/api/v1/jobs/{job}", app.base))
                .send()
                .await?
                .json()
                .await?;
            if job["state"] == "failed" {
                return Err(format!("job failed: {job}").into());
            }
            if job["state"] == "succeeded" {
                return Ok::<_, Box<dyn std::error::Error>>(());
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
    })
    .await??;
    Ok(())
}
#[tokio::test]
async fn running_edits_are_versioned_pending_until_explicit_restart() -> Result {
    let app = TestApp::with_auth(false).await?;
    let (id, dir) = create(&app).await?;
    std::fs::write(dir.join("server.jar"), "fixture")?;
    let original = std::fs::read_to_string(dir.join("server.properties"))?;
    let first = read(&app, &id).await?;
    assert_eq!(first["version"], 1);
    assert_eq!(first["appliedVersion"], Value::Null);
    action(&app, &id, "start").await?;
    let running = read(&app, &id).await?;
    assert_eq!(running["appliedVersion"], 1);
    assert_eq!(running["restartRequired"], false);
    let edited = save(
        &app,
        &id,
        "# preserve this\nwhite-list=false\nonline-mode=false\n",
        &running["etag"],
    )
    .await?;
    assert_eq!(edited["version"], 2);
    assert_eq!(edited["appliedVersion"], 1);
    assert_eq!(edited["restartRequired"], true);
    assert_eq!(
        std::fs::read_to_string(dir.join("server.properties"))?,
        original
    );
    let unchanged = save(
        &app,
        &id,
        edited["content"].as_str().ok_or("content")?,
        &edited["etag"],
    )
    .await?;
    assert_eq!(
        unchanged["version"], 2,
        "no-op autosaves must not create revisions"
    );
    action(&app, &id, "restart").await?;
    let applied = read(&app, &id).await?;
    assert_eq!(applied["appliedVersion"], 2);
    assert_eq!(applied["restartRequired"], false);
    assert_eq!(
        std::fs::read_to_string(dir.join("server.properties"))?,
        edited["content"].as_str().ok_or("content")?
    );
    let restored: Value = app
        .post(&format!("/api/v1/servers/{id}/properties/restore"))
        .json(&json!({"version":1,"etag":applied["etag"]}))
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    assert_eq!(restored["version"], 3);
    assert_eq!(restored["appliedVersion"], 2);
    assert_eq!(restored["restartRequired"], true);
    let history: Value = app
        .client
        .get(format!(
            "{}/api/v1/servers/{id}/properties/versions?limit=2",
            app.base
        ))
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    assert_eq!(history["items"][0]["source"], "restore");
    assert_eq!(history["nextBefore"], 2);
    let old: Value = app
        .client
        .get(format!(
            "{}/api/v1/servers/{id}/properties/versions/1",
            app.base
        ))
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    assert_eq!(old["content"], original);
    app.close().await
}
#[tokio::test]
async fn stale_writes_are_rejected_and_generic_mutations_cannot_bypass_history() -> Result {
    let app = TestApp::with_auth(false).await?;
    let (id, directory) = create(&app).await?;
    let first = read(&app, &id).await?;
    let newer = save(&app, &id, "motd=new\n", &first["etag"]).await?;
    let route = format!("{}/api/v1/servers/{id}/properties", app.base);
    assert_eq!(
        app.client
            .put(&route)
            .header("Origin", &app.base)
            .header("X-MCM-CSRF", "1")
            .json(&json!({"content":"stale","etag":first["etag"]}))
            .send()
            .await?
            .status(),
        409
    );
    assert_eq!(
        app.client
            .put(&route)
            .json(&json!({"content":"no csrf","etag":newer["etag"]}))
            .send()
            .await?
            .status(),
        403
    );
    for (action, body) in [
        (
            "delete",
            json!({"path":"server.properties","recursive":false}),
        ),
        ("move", json!({"from":"server.properties","to":"old"})),
        ("copy", json!({"from":"other","to":"server.properties"})),
    ] {
        assert_eq!(
            app.post(&format!("/api/v1/servers/{id}/files/{action}"))
                .json(&body)
                .send()
                .await?
                .status(),
            403
        );
    }
    let compat: Value = app
        .client
        .get(format!(
            "{}/api/v1/servers/{id}/files/content?path=server.properties",
            app.base
        ))
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    assert_eq!(compat["etag"], newer["etag"]);
    assert_eq!(compat["content"], "motd=new\n");
    // Foreign-key cascades must allow deleting a record with version history.
    app.backend.state.servers.delete(&id, false).await?;
    assert_eq!(
        std::fs::read_to_string(directory.join("server.properties"))?,
        "motd=new\n"
    );
    assert_eq!(app.client.get(route).send().await?.status(), 404);
    app.close().await
}

#[tokio::test]
async fn desired_history_survives_manager_restart_with_docker_unavailable() -> Result {
    let directory = tempfile::tempdir()?;
    let mut config = chunkyard_config::Config {
        data_dir: directory.path().to_owned(),
        ..Default::default()
    };
    config.auth.enabled = false;
    config.docker.enabled = false;
    let backend = chunkyard_server::wiring::build_state(&config).await?;
    let server = backend
        .state
        .servers
        .create(serde_json::from_value(json!({"name":"Offline engine"}))?)
        .await?;
    let first = backend
        .state
        .properties
        .properties(&server.server.id)
        .await?;
    let changed = backend
        .state
        .properties
        .save_properties(
            &server.server.id,
            chunkyard_core::properties::PropertiesWrite {
                content: "motd=durable draft\n".into(),
                etag: first.etag,
            },
        )
        .await?;
    assert_eq!(
        changed.status.state,
        chunkyard_core::server::ServerState::Unknown
    );
    backend.shutdown().await;
    drop(backend);
    let reopened = chunkyard_server::wiring::build_state(&config).await?;
    let persisted = reopened
        .state
        .properties
        .properties(&server.server.id)
        .await?;
    assert_eq!(persisted.content, "motd=durable draft\n");
    assert_eq!(persisted.version, changed.version);
    assert!(persisted.applied_version.is_none());
    reopened.shutdown().await;
    Ok(())
}

#[tokio::test]
async fn legacy_running_files_are_imported_without_overwriting_pending_owner_edits() -> Result {
    use chunkyard_core::properties::PropertiesRepo;
    let app = TestApp::with_auth(false).await?;
    let (id, directory) = create(&app).await?;
    std::fs::write(directory.join("server.jar"), "fixture")?;
    action(&app, &id, "start").await?;
    chunkyard_db::SqlitePropertiesRepo::new(&app.backend.database)
        .set_applied(&id, None, None)
        .await?;
    // A console command can persist settings on a legacy, untracked process.
    std::fs::write(directory.join("server.properties"), "white-list=false\n")?;
    let imported = read(&app, &id).await?;
    assert_eq!(imported["content"], "white-list=false\n");
    assert_eq!(imported["appliedVersion"], Value::Null);
    let desired = save(
        &app,
        &id,
        "white-list=false\nmotd=owner draft\n",
        &imported["etag"],
    )
    .await?;
    std::fs::write(directory.join("server.properties"), "white-list=true\n")?;
    let retained = read(&app, &id).await?;
    assert_eq!(retained["version"], desired["version"]);
    assert_eq!(retained["content"], desired["content"]);
    app.close().await
}
