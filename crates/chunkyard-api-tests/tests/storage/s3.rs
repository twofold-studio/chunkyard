use super::support::{Result, Store, completed, read, remove, save};
use crate::common::TestApp;
use axum::{Router, routing::put};
use serde_json::{Value, json};
use std::sync::atomic::Ordering;

#[tokio::test]
async fn s3_verification_redaction_catalog_and_deletion_round_trip() -> Result {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
    let endpoint = format!("http://{}", listener.local_addr()?);
    let store = Store::default();
    let router = Router::new()
        .route("/chunkyard/{*key}", put(save).get(read).delete(remove))
        .with_state(store.clone());
    let server = tokio::spawn(async move { axum::serve(listener, router).await });
    let app = TestApp::with_auth(false).await?;
    let storage = json!({"endpoint":endpoint,"bucket":"chunkyard","region":"us-east-1","prefix":"archives","accessKeyId":"test-access","secretAccessKey":"never-return-this-secret"});
    let url = format!("{}/api/v1/storage", app.base);
    let saved = app
        .client
        .put(&url)
        .header("Origin", &app.base)
        .header("X-MCM-CSRF", "1")
        .json(&storage)
        .send()
        .await?
        .error_for_status()?
        .text()
        .await?;
    assert!(!saved.contains("never-return-this-secret"));
    assert!(!saved.contains("secretAccessKey"));
    assert_eq!(app.post("/api/v1/storage/test").send().await?.status(), 200);
    assert!(
        store
            .objects
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .is_empty()
    );
    let stored_path = app.directory.path().join("exports/storage.json");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            std::fs::metadata(&stored_path)?.permissions().mode() & 0o777,
            0o600
        );
    }
    let mut no_secret = storage.clone();
    no_secret
        .as_object_mut()
        .ok_or("object")?
        .remove("secretAccessKey");
    assert_eq!(
        app.client
            .put(&url)
            .header("Origin", &app.base)
            .header("X-MCM-CSRF", "1")
            .json(&no_secret)
            .send()
            .await?
            .status(),
        200
    );
    let instance: Value = app
        .post("/api/v1/servers")
        .json(&json!({"name":"S3"}))
        .send()
        .await?
        .json()
        .await?;
    let id = instance["server"]["id"].as_str().ok_or("id")?;
    std::fs::write(
        app.directory
            .path()
            .join("servers")
            .join(id)
            .join("file.txt"),
        "store me",
    )?;
    let request = || {
        app.post(&format!("/api/v1/servers/{id}/exports"))
            .json(&json!({"scope":"all","destination":"s3"}))
    };
    let job = completed(&app, request().send().await?.json().await?).await?;
    assert_eq!(job["state"], "succeeded", "{job}");
    assert_eq!(
        store
            .objects
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .len(),
        1
    );
    let record = &job["result"];
    let export_id = record["id"].as_str().ok_or("export")?;
    assert!(
        !app.directory
            .path()
            .join("exports")
            .join(record["fileName"].as_str().ok_or("name")?)
            .exists()
    );
    let download = app
        .client
        .get(format!("{}/api/v1/exports/{export_id}/download", app.base))
        .send()
        .await?
        .error_for_status()?
        .bytes()
        .await?;
    use sha2::{Digest, Sha256};
    assert_eq!(format!("{:x}", Sha256::digest(download)), record["sha256"]);
    let mut changed = storage.clone();
    changed["prefix"] = json!("different");
    assert_eq!(
        app.client
            .put(&url)
            .header("Origin", &app.base)
            .header("X-MCM-CSRF", "1")
            .json(&changed)
            .send()
            .await?
            .status(),
        409
    );
    store.corrupt.store(true, Ordering::Relaxed);
    let failed = completed(&app, request().send().await?.json().await?).await?;
    assert_eq!(failed["state"], "failed");
    assert_eq!(
        store
            .objects
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .len(),
        1
    );
    let listing: Value = app
        .client
        .get(format!("{}/api/v1/exports", app.base))
        .send()
        .await?
        .json()
        .await?;
    assert_eq!(listing["items"].as_array().ok_or("items")?.len(), 1);
    assert_eq!(
        app.client
            .delete(format!("{}/api/v1/exports/{export_id}", app.base))
            .header("Origin", &app.base)
            .header("X-MCM-CSRF", "1")
            .send()
            .await?
            .status(),
        204
    );
    assert!(
        store
            .objects
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .is_empty()
    );
    app.close().await?;
    server.abort();
    Ok(())
}
