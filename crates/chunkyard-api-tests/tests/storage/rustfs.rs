use super::support::Result;
use crate::common::TestApp;
use serde_json::json;

#[tokio::test]
#[ignore = "requires CHUNKYARD_TEST_S3_ENDPOINT/ACCESS_KEY/SECRET_KEY and a disposable object prefix"]
async fn real_rustfs_archive_upload_verified_download_and_cleanup() -> Result {
    use chunkyard_core::exports::{
        ExportDestination, ExportRequest, ExportScope, StorageConnection,
    };
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
