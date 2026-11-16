use crate::common::TestApp;
use serde_json::{Value, json};
use std::error::Error;
async fn job(app: &TestApp, path: &str) -> Result<Value, Box<dyn Error>> {
    let response = app.post(path).send().await?;
    assert_eq!(response.status(), 202);
    let value: Value = response.json().await?;
    let id = value["job"]["id"].as_str().ok_or("no job")?;
    for _ in 0..100 {
        let result: Value = app
            .client
            .get(format!("{}/api/v1/jobs/{id}", app.base))
            .send()
            .await?
            .json()
            .await?;
        if result["state"] == "succeeded" || result["state"] == "failed" {
            return Ok(result);
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    Err("job timeout".into())
}
#[tokio::test]
async fn managed_install_is_pinned_and_requires_explicit_eula_and_start()
-> Result<(), Box<dyn Error>> {
    let app = TestApp::with_auth(false).await?;
    let response=app.post("/api/v1/servers").json(&json!({"name":"Paper","port":25565,"software":{"type":"paper","version":"1.21.4","build":"231"}})).send().await?;
    assert_eq!(response.status(), 201);
    let created: Value = response.json().await?;
    let id = created["server"]["id"].as_str().ok_or("id")?;
    assert!(created["server"]["launch"].is_null());
    let start = job(&app, &format!("/api/v1/servers/{id}/start")).await?;
    assert_eq!(start["error"]["code"], "server.not_installed");
    let result = job(&app, &format!("/api/v1/servers/{id}/install")).await?;
    assert_eq!(result["state"], "succeeded");
    let server = &result["result"]["server"];
    assert_eq!(server["launch"]["build"], "231");
    assert_eq!(server["dockerImage"], "eclipse-temurin:21-jre");
    assert_eq!(server["acceptEula"], false);
    assert_eq!(server["status"]["state"], "stopped");
    let persisted: Value = app
        .client
        .get(format!("{}/api/v1/servers/{id}", app.base))
        .send()
        .await?
        .json()
        .await?;
    assert_eq!(persisted["launch"], server["launch"]);
    assert_eq!(persisted["jar"], server["launch"]["path"]);
    let jar = app
        .directory
        .path()
        .join("servers")
        .join(id)
        .join(server["launch"]["path"].as_str().ok_or("path")?);
    assert_eq!(tokio::fs::read_to_string(jar).await?, "fixture");
    let start = job(&app, &format!("/api/v1/servers/{id}/start")).await?;
    assert_eq!(start["error"]["code"], "server.eula_required");
    let reinstall = job(&app, &format!("/api/v1/servers/{id}/install")).await?;
    assert_eq!(reinstall["error"]["code"], "server.already_installed");
    app.post(&format!("/api/v1/servers/{id}/eula"))
        .json(&json!({"accepted":true}))
        .send()
        .await?
        .error_for_status()?;
    assert_eq!(
        job(&app, &format!("/api/v1/servers/{id}/start")).await?["state"],
        "succeeded"
    );
    app.close().await
}
#[tokio::test]
async fn failed_install_cleans_partial_files_and_retries_same_record() -> Result<(), Box<dyn Error>>
{
    let app = TestApp::with_auth(false).await?;
    let created:Value=app.post("/api/v1/servers").json(&json!({"name":"Vanilla","port":25565,"dockerImage":"custom:21","software":{"type":"vanilla","version":"retry"}})).send().await?.json().await?;
    let id = created["server"]["id"].as_str().ok_or("id")?;
    let path = format!("/api/v1/servers/{id}/install");
    assert_eq!(
        job(&app, &path).await?["error"]["code"],
        "software.download_failed"
    );
    let mut entries = tokio::fs::read_dir(app.directory.path().join("servers").join(id)).await?;
    while let Some(entry) = entries.next_entry().await? {
        assert!(
            !entry
                .file_name()
                .to_string_lossy()
                .starts_with(".chunkyard-software-")
        );
    }
    let result = job(&app, &path).await?;
    assert_eq!(result["state"], "succeeded");
    assert_eq!(result["result"]["server"]["dockerImage"], "custom:21");
    let servers: Value = app
        .client
        .get(format!("{}/api/v1/servers", app.base))
        .send()
        .await?
        .json()
        .await?;
    assert_eq!(servers["items"].as_array().ok_or("items")?.len(), 1);
    app.close().await
}
#[tokio::test]
async fn catalogs_require_auth_and_install_requires_csrf() -> Result<(), Box<dyn Error>> {
    let app = TestApp::new().await?;
    assert_eq!(
        app.client
            .get(format!("{}/api/v1/software", app.base))
            .send()
            .await?
            .status(),
        503
    );
    app.setup().await?;
    for path in [
        "/api/v1/software",
        "/api/v1/software/vanilla/versions",
        "/api/v1/software/paper/versions/1.21.4/builds",
    ] {
        assert_eq!(
            app.client
                .get(format!("{}{path}", app.base))
                .send()
                .await?
                .status(),
            200
        );
    }
    assert_eq!(
        app.client
            .post(format!("{}/api/v1/servers/unknown/install", app.base))
            .send()
            .await?
            .status(),
        403
    );
    assert_eq!(
        app.post("/api/v1/servers/unknown/install")
            .send()
            .await?
            .status(),
        404
    );
    for software in [
        json!({"type":"forge","version":"1.21"}),
        json!({"type":"paper","version":"../escape"}),
        json!({"type":"paper","version":"1.21","build":"https://evil"}),
    ] {
        assert!(
            app.post("/api/v1/servers")
                .json(&json!({"name":"Bad","port":25565,"software":software}))
                .send()
                .await?
                .status()
                .is_client_error()
        );
    }
    app.close().await
}
