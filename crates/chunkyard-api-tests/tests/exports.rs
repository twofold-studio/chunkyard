mod common;
use common::TestApp;
use serde_json::{Value, json};
use std::io::Read;
type Result<T = ()> = std::result::Result<T, Box<dyn std::error::Error>>;
async fn job(app: &TestApp, response: reqwest::Response) -> Result<Value> {
    let body: Value = response.error_for_status()?.json().await?;
    let id = body["job"]["id"].as_str().ok_or("job id")?;
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
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    Err("job timeout".into())
}
async fn instance(app: &TestApp) -> Result<(String, std::path::PathBuf)> {
    let body: Value = app
        .post("/api/v1/servers")
        .json(&json!({"name":"Export fixture","acceptEula":true}))
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    let id = body["server"]["id"].as_str().ok_or("id")?.to_owned();
    let path = app.directory.path().join("servers").join(&id);
    std::fs::create_dir_all(path.join("custom-world/region"))?;
    std::fs::write(path.join("custom-world/level.dat"), b"world")?;
    std::fs::write(path.join("custom-world/region/r.0.0.mca"), b"chunks")?;
    std::fs::write(path.join("server.jar"), b"fixture")?;
    std::fs::create_dir(path.join(".chunkyard-software-fixture"))?;
    std::fs::write(
        path.join(".chunkyard-software-fixture/server.jar"),
        b"managed-jar",
    )?;
    Ok((id, path))
}
#[tokio::test]
async fn exports_preserve_world_selection_desired_properties_and_survive_instance_deletion()
-> Result {
    let app = TestApp::with_auth(false).await?;
    let (id, path) = instance(&app).await?;
    let properties: Value = app
        .client
        .get(format!("{}/api/v1/servers/{id}/properties", app.base))
        .send()
        .await?
        .json()
        .await?;
    app.client
        .put(format!("{}/api/v1/servers/{id}/properties", app.base))
        .header("Origin", &app.base)
        .header("X-MCM-CSRF", "1")
        .json(&json!({"etag":properties["etag"],"content":"motd=desired\n"}))
        .send()
        .await?
        .error_for_status()?;
    for scope in ["world", "selected", "all"] {
        let mut request = json!({"scope":scope,"destination":"local"});
        if scope == "selected" {
            request["paths"] = json!(["custom-world", "custom-world/level.dat"]);
        }
        let completed = job(
            &app,
            app.post(&format!("/api/v1/servers/{id}/exports"))
                .json(&request)
                .send()
                .await?,
        )
        .await?;
        assert_eq!(completed["state"], "succeeded", "{completed}");
        assert_eq!(completed["work"]["stage"], "finalize");
        assert!(
            completed["work"]["completedStages"]
                .as_array()
                .ok_or("stages")?
                .contains(&json!("compress"))
        );
        let export = completed["result"]["id"].as_str().ok_or("export id")?;
        let bytes = app
            .client
            .get(format!("{}/api/v1/exports/{export}/download", app.base))
            .send()
            .await?
            .error_for_status()?
            .bytes()
            .await?;
        use sha2::{Digest, Sha256};
        assert_eq!(
            format!("{:x}", Sha256::digest(&bytes)),
            completed["result"]["sha256"]
        );
        let mut archive = tar::Archive::new(flate2::read::GzDecoder::new(&bytes[..]));
        let mut contents = std::collections::BTreeMap::new();
        for entry in archive.entries()? {
            let mut entry = entry?;
            if entry.header().entry_type().is_file() {
                let name = entry.path()?.to_string_lossy().into_owned();
                let mut value = String::new();
                entry.read_to_string(&mut value)?;
                assert!(contents.insert(name, value).is_none());
            }
        }
        assert_eq!(
            contents
                .get("custom-world/region/r.0.0.mca")
                .map(String::as_str),
            Some("chunks")
        );
        if scope == "all" {
            assert_eq!(
                contents.get("server.properties").map(String::as_str),
                Some("motd=desired\n")
            );
            assert!(contents.contains_key(".chunkyard-export.json"));
            assert!(contents.contains_key(".chunkyard-software-fixture/server.jar"));
        } else {
            assert!(!contents.contains_key("server.jar"));
        }
    }
    let deletion = app
        .client
        .delete(format!("{}/api/v1/servers/{id}?deleteFiles=true", app.base))
        .header("Origin", &app.base)
        .header("X-MCM-CSRF", "1")
        .send()
        .await?;
    assert_eq!(job(&app, deletion).await?["state"], "succeeded");
    assert!(!path.exists());
    let exports: Value = app
        .client
        .get(format!("{}/api/v1/exports", app.base))
        .send()
        .await?
        .json()
        .await?;
    assert_eq!(exports["items"].as_array().ok_or("items")?.len(), 3);
    let export = exports["items"][0]["id"].as_str().ok_or("id")?;
    assert_eq!(
        app.client
            .get(format!("{}/api/v1/exports/{export}/download", app.base))
            .send()
            .await?
            .status(),
        200
    );
    assert_eq!(
        app.client
            .delete(format!("{}/api/v1/exports/{export}", app.base))
            .send()
            .await?
            .status(),
        403
    );
    assert_eq!(
        app.client
            .delete(format!("{}/api/v1/exports/{export}", app.base))
            .header("Origin", &app.base)
            .header("X-MCM-CSRF", "1")
            .send()
            .await?
            .status(),
        204
    );
    app.close().await
}
#[tokio::test]
async fn exports_reject_unsafe_paths_running_instances_and_unconfigured_s3() -> Result {
    let app = TestApp::with_auth(false).await?;
    let (id, _) = instance(&app).await?;
    for request in [
        json!({"scope":"selected","paths":["../mcm.db"],"destination":"local"}),
        json!({"scope":"selected","paths":[],"destination":"local"}),
        json!({"scope":"all","destination":"s3"}),
    ] {
        let completed = job(
            &app,
            app.post(&format!("/api/v1/servers/{id}/exports"))
                .json(&request)
                .send()
                .await?,
        )
        .await?;
        assert_eq!(completed["state"], "failed");
    }
    assert_eq!(
        job(
            &app,
            app.post(&format!("/api/v1/servers/{id}/start"))
                .send()
                .await?
        )
        .await?["state"],
        "succeeded"
    );
    let completed = job(
        &app,
        app.post(&format!("/api/v1/servers/{id}/exports"))
            .json(&json!({"scope":"all","destination":"local"}))
            .send()
            .await?,
    )
    .await?;
    assert_eq!(completed["state"], "failed");
    app.close().await
}
#[tokio::test]
async fn resources_update_only_stopped_instances_and_validate_limits() -> Result {
    let app = TestApp::with_auth(false).await?;
    let (id, _) = instance(&app).await?;
    let url = format!("{}/api/v1/servers/{id}/resources", app.base);
    for (min, max, cpus, status) in [
        (512, 4096, 1.5, 200),
        (127, 4096, 1.0, 422),
        (4096, 512, 1.0, 422),
        (512, 4096, 0.0, 422),
    ] {
        let response = app
            .client
            .patch(&url)
            .header("Origin", &app.base)
            .header("X-MCM-CSRF", "1")
            .json(&json!({"memoryMinMb":min,"memoryMaxMb":max,"cpus":cpus}))
            .send()
            .await?;
        assert_eq!(response.status(), status);
    }
    let server: Value = app
        .client
        .get(format!("{}/api/v1/servers/{id}", app.base))
        .send()
        .await?
        .json()
        .await?;
    assert_eq!(server["memoryMaxMb"], 4096);
    assert_eq!(server["cpus"], 1.5);
    assert_eq!(
        job(
            &app,
            app.post(&format!("/api/v1/servers/{id}/start"))
                .send()
                .await?
        )
        .await?["state"],
        "succeeded"
    );
    assert_eq!(
        app.client
            .patch(url)
            .header("Origin", &app.base)
            .header("X-MCM-CSRF", "1")
            .json(&json!({"memoryMinMb":512,"memoryMaxMb":2048,"cpus":2}))
            .send()
            .await?
            .status(),
        409
    );
    app.close().await
}
