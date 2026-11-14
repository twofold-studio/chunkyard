mod common;
use axum::{
    Router,
    body::Bytes,
    extract::{Path, State},
    http::StatusCode,
    routing::put,
};
use common::TestApp;
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
};
type Result<T = ()> = std::result::Result<T, Box<dyn std::error::Error>>;
#[derive(Clone, Default)]
struct Store {
    objects: Arc<Mutex<HashMap<String, Vec<u8>>>>,
    corrupt: Arc<AtomicBool>,
}
async fn save(State(s): State<Store>, Path(key): Path<String>, bytes: Bytes) -> StatusCode {
    s.objects
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .insert(key, bytes.to_vec());
    StatusCode::OK
}
async fn read(State(s): State<Store>, Path(key): Path<String>) -> (StatusCode, Vec<u8>) {
    if s.corrupt.load(Ordering::Relaxed) {
        return (StatusCode::OK, b"corrupted".to_vec());
    }
    match s
        .objects
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .get(&key)
    {
        Some(bytes) => (StatusCode::OK, bytes.clone()),
        None => (StatusCode::NOT_FOUND, vec![]),
    }
}
async fn remove(State(s): State<Store>, Path(key): Path<String>) -> StatusCode {
    s.objects
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .remove(&key);
    StatusCode::NO_CONTENT
}
async fn completed(app: &TestApp, body: Value) -> Result<Value> {
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
    Err("timeout".into())
}

#[tokio::test]
#[ignore = "requires CHUNKYARD_TEST_S3_ENDPOINT/ACCESS_KEY/SECRET_KEY and a disposable object prefix"]
async fn real_rustfs_archive_upload_verified_download_and_cleanup() -> Result {
    use mcm_core::exports::{ExportDestination, ExportRequest, ExportScope, StorageConnection};
    let app = TestApp::with_auth(false).await?;
    app.backend
        .state
        .exports
        .set_storage(StorageConnection {
            endpoint: std::env::var("CHUNKYARD_TEST_S3_ENDPOINT")?,
            region: "us-east-1".into(),
            bucket: std::env::var("CHUNKYARD_TEST_S3_BUCKET")
                .unwrap_or_else(|_| "chunkyard".into()),
            prefix: format!("integration-test-{}", uuid::Uuid::new_v4()),
            access_key_id: std::env::var("CHUNKYARD_TEST_S3_ACCESS_KEY")?,
            secret_access_key: Some(std::env::var("CHUNKYARD_TEST_S3_SECRET_KEY")?),
        })
        .await?;
    app.backend.state.exports.test_storage().await?;
    let instance = app
        .backend
        .state
        .servers
        .create(serde_json::from_value(
            json!({"name":"RustFS disposable export test"}),
        )?)
        .await?;
    std::fs::write(
        instance.directory.join("marker.txt"),
        "RustFS verified round trip",
    )?;
    let export = app
        .backend
        .state
        .exports
        .create(
            &instance.server.id,
            ExportRequest {
                scope: ExportScope::All,
                paths: vec![],
                destination: ExportDestination::S3,
            },
        )
        .await?;
    // The archive remains accessible after all original instance files are removed.
    app.backend
        .state
        .servers
        .delete(&instance.server.id, true)
        .await?;
    assert!(!instance.directory.exists());
    let mut download = app.backend.state.exports.download(&export.id).await?;
    use futures_util::StreamExt;
    use sha2::{Digest, Sha256};
    let mut hash = Sha256::new();
    let mut size = 0u64;
    while let Some(chunk) = download.stream.next().await {
        let chunk = chunk?;
        size += chunk.len() as u64;
        hash.update(chunk);
    }
    assert_eq!(size, export.size);
    assert_eq!(format!("{:x}", hash.finalize()), export.sha256);
    app.backend.state.exports.delete(&export.id).await?;
    assert!(app.backend.state.exports.list().await?.is_empty());
    app.close().await
}
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
