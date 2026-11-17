use super::file_support::{Result, create, put};
use crate::common::TestApp;
use serde_json::json;

#[tokio::test]
async fn editor_accepts_one_mebibyte_with_json_escaping_beyond_default_limit() -> Result {
    let app = TestApp::with_auth(false).await?;
    let (id, _) = create(&app).await?;
    let route = format!("/api/v1/servers/{id}/files/content?path=escaped.txt");
    let content = "\t".repeat(chunkyard_core::files::TEXT_LIMIT as usize);
    assert_eq!(
        put(&app, &route)
            .json(&json!({"content":content,"etag":null}))
            .send()
            .await?
            .status(),
        200
    );
    let too_big = "x".repeat(chunkyard_core::files::TEXT_LIMIT as usize + 1);
    assert_eq!(
        put(&app, &route)
            .json(&json!({"content":too_big,"etag":null}))
            .send()
            .await?
            .status(),
        413
    );
    app.close().await
}

#[tokio::test]
async fn raw_uploads_bypass_json_limit_and_support_explicit_replacement() -> Result {
    let app = TestApp::with_auth(false).await?;
    let (id, directory) = create(&app).await?;
    let route = format!("/api/v1/servers/{id}/files/upload?path=large.dat");
    let bytes = vec![42; 2 * 1024 * 1024];
    let response = app
        .post(&route)
        .header("Content-Type", "application/octet-stream")
        .body(bytes.clone())
        .send()
        .await?;
    assert_eq!(response.status(), 201);
    assert_eq!(std::fs::read(directory.join("large.dat"))?, bytes);
    assert_eq!(
        app.post(&format!("{route}&overwrite=true"))
            .body("replacement")
            .send()
            .await?
            .status(),
        201
    );
    assert_eq!(
        std::fs::read_to_string(directory.join("large.dat"))?,
        "replacement"
    );
    app.close().await
}

#[tokio::test]
async fn concurrent_listing_and_editor_reads_do_not_reject_each_other() -> Result {
    let app = TestApp::with_auth(false).await?;
    let (id, directory) = create(&app).await?;
    std::fs::write(
        directory.join("server.properties"),
        "motd=concurrent reads\n",
    )?;
    let requests = (0..24).map(|index| {
        let suffix = if index % 2 == 0 {
            ""
        } else {
            "/content?path=server.properties"
        };
        app.client
            .get(format!("{}/api/v1/servers/{id}/files{suffix}", app.base))
            .send()
    });
    for response in futures_util::future::join_all(requests).await {
        assert_eq!(response?.status(), 200);
    }
    app.close().await
}

#[tokio::test]
async fn cancelled_upload_retains_lifecycle_lock_until_worker_finishes() -> Result {
    struct BlockingReader {
        entered: Option<tokio::sync::oneshot::Sender<()>>,
        release: std::sync::mpsc::Receiver<()>,
    }
    impl std::io::Read for BlockingReader {
        fn read(&mut self, _: &mut [u8]) -> std::io::Result<usize> {
            if let Some(entered) = self.entered.take() {
                let _ = entered.send(());
            }
            let _ = self.release.recv();
            Err(std::io::Error::other("cancelled fixture upload"))
        }
    }
    let app = TestApp::with_auth(false).await?;
    let (id, directory) = create(&app).await?;
    let (entered, ready) = tokio::sync::oneshot::channel();
    let (release, wait) = std::sync::mpsc::channel();
    let files = app.backend.state.files.clone();
    let upload_id = id.clone();
    let task = tokio::spawn(async move {
        files
            .upload(
                &upload_id,
                "pending".into(),
                false,
                Box::new(BlockingReader {
                    entered: Some(entered),
                    release: wait,
                }),
            )
            .await
    });
    tokio::time::timeout(std::time::Duration::from_secs(5), ready).await??;
    task.abort();
    let _ = task.await;
    let result = app.backend.state.servers.delete(&id, false).await;
    // Always unblock the worker, including when the assertion fails.
    release.send(())?;
    assert!(matches!(
        result,
        Err(chunkyard_core::server::ServerError::Busy)
    ));
    // Wait for worker cleanup via the same public lock rather than a fixed sleep.
    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        loop {
            match app.backend.state.files.list(&id, String::new()).await {
                Err(chunkyard_core::files::FileError::Server(
                    chunkyard_core::server::ServerError::Busy,
                )) => tokio::task::yield_now().await,
                result => break result,
            }
        }
    })
    .await??;
    assert!(!directory.join("pending").exists());
    assert!(!std::fs::read_dir(directory)?.any(|e| e.is_ok_and(|e| {
        e.file_name()
            .to_string_lossy()
            .starts_with(".chunkyard-file-")
    })));
    app.close().await
}
