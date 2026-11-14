mod common;
use common::TestApp;
use serde_json::{Value, json};
type Result<T = ()> = std::result::Result<T, Box<dyn std::error::Error>>;

async fn create(app: &TestApp) -> Result<(String, std::path::PathBuf)> {
    let created: Value = app
        .post("/api/v1/servers")
        .json(&json!({"name":"Files","acceptEula":true}))
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    Ok((
        created["server"]["id"].as_str().ok_or("id")?.into(),
        created["server"]["directory"]
            .as_str()
            .ok_or("directory")?
            .into(),
    ))
}
fn put(app: &TestApp, route: &str) -> reqwest::RequestBuilder {
    app.client
        .put(format!("{}{route}", app.base))
        .header("Origin", &app.base)
        .header("X-MCM-CSRF", "1")
}

#[tokio::test]
async fn browser_file_workflow_round_trips_text_and_binary_attachments() -> Result {
    let app = TestApp::with_auth(false).await?;
    let (id, _) = create(&app).await?;
    let base = format!("/api/v1/servers/{id}/files");
    assert_eq!(
        app.post(&format!("{base}/mkdir"))
            .json(&json!({"path":"config"}))
            .send()
            .await?
            .status(),
        201
    );
    let route = format!("{base}/content?path=config/test.txt");
    let saved: Value = put(&app, &route)
        .json(&json!({"content":"hello 🌍\n","etag":null}))
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    let read: Value = app
        .client
        .get(format!("{}{route}", app.base))
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    assert_eq!(read["content"], "hello 🌍\n");
    assert_eq!(read["etag"], saved["etag"]);
    assert_eq!(
        put(&app, &route)
            .json(&json!({"content":"wrong","etag":"stale"}))
            .send()
            .await?
            .status(),
        409
    );
    let updated = put(&app, &route)
        .json(&json!({"content":"updated","etag":read["etag"]}))
        .send()
        .await?;
    assert_eq!(updated.status(), 200);
    let upload = format!("{base}/upload?path=config/binary.dat");
    let bytes = vec![0, 1, 255, 42];
    assert_eq!(
        app.post(&upload)
            .header("Content-Type", "application/octet-stream")
            .body(bytes.clone())
            .send()
            .await?
            .status(),
        201
    );
    assert_eq!(
        app.post(&upload).body("duplicate").send().await?.status(),
        409
    );
    let download = app
        .client
        .get(format!(
            "{}{base}/download?path=config/binary.dat",
            app.base
        ))
        .send()
        .await?
        .error_for_status()?;
    assert_eq!(
        download.headers()["content-type"],
        "application/octet-stream"
    );
    assert!(
        download.headers()["content-disposition"]
            .to_str()?
            .starts_with("attachment;")
    );
    assert_eq!(download.headers()["x-content-type-options"], "nosniff");
    assert_eq!(download.bytes().await?.as_ref(), bytes);
    for (action, body) in [
        ("copy", json!({"from":"config","to":"backup"})),
        (
            "move",
            json!({"from":"backup/test.txt","to":"backup/renamed.txt"}),
        ),
    ] {
        assert_eq!(
            app.post(&format!("{base}/{action}"))
                .json(&body)
                .send()
                .await?
                .status(),
            200
        );
    }
    assert_eq!(
        app.post(&format!("{base}/delete"))
            .json(&json!({"path":"backup","recursive":false}))
            .send()
            .await?
            .status(),
        409
    );
    assert_eq!(
        app.post(&format!("{base}/delete"))
            .json(&json!({"path":"backup","recursive":true}))
            .send()
            .await?
            .status(),
        204
    );
    app.close().await
}

#[tokio::test]
async fn file_routes_enforce_auth_csrf_and_instance_boundaries() -> Result {
    let app = TestApp::new().await?;
    assert_eq!(
        app.client
            .get(format!("{}/api/v1/servers/anything/files", app.base))
            .send()
            .await?
            .status(),
        503
    );
    app.setup().await?;
    let (id, directory) = create(&app).await?;
    let base = format!("/api/v1/servers/{id}/files");
    assert_eq!(
        app.client
            .post(format!("{}{base}/mkdir", app.base))
            .json(&json!({"path":"missing-csrf"}))
            .send()
            .await?
            .status(),
        403
    );
    for path in ["../setup-token", "/etc/passwd", "a\\b", "a/../b"] {
        let response = app
            .client
            .get(format!("{}{base}/content", app.base))
            .query(&[("path", path)])
            .send()
            .await?;
        assert_eq!(response.status(), 422, "{path}");
    }
    std::fs::write(directory.join(".chunkyard-test.jar"), "private")?;
    let listing: Value = app
        .client
        .get(format!("{}{base}", app.base))
        .send()
        .await?
        .json()
        .await?;
    assert!(
        !listing["entries"]
            .as_array()
            .ok_or("entries")?
            .iter()
            .any(|e| e["name"] == ".chunkyard-test.jar")
    );
    for path in ["eula.txt", ".chunkyard-test.jar"] {
        assert_eq!(
            app.post(&format!("{base}/delete"))
                .json(&json!({"path":path,"recursive":false}))
                .send()
                .await?
                .status(),
            403
        );
    }
    app.close().await
}

#[tokio::test]
async fn running_instances_allow_reads_and_refuse_all_file_mutations() -> Result {
    let app = TestApp::with_auth(false).await?;
    let (id, directory) = create(&app).await?;
    std::fs::write(directory.join("server.jar"), "fixture")?;
    std::fs::write(directory.join("server.properties"), "online-mode=true\n")?;
    std::fs::write(directory.join("notes.txt"), "ordinary file\n")?;
    let server = format!("/api/v1/servers/{id}");
    let pending: Value = app
        .post(&format!("{server}/start"))
        .send()
        .await?
        .json()
        .await?;
    let job = pending["job"]["id"].as_str().ok_or("job")?;
    let mut started = false;
    for _ in 0..200 {
        let state: Value = app
            .client
            .get(format!("{}/api/v1/jobs/{job}", app.base))
            .send()
            .await?
            .json()
            .await?;
        if state["state"] == "succeeded" {
            started = true;
            break;
        }
        assert_ne!(state["state"], "failed", "{state}");
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    assert!(
        started,
        "start job must finish before checking runtime file restrictions"
    );
    let list: Value = app
        .client
        .get(format!("{}{server}/files", app.base))
        .send()
        .await?
        .json()
        .await?;
    assert_eq!(list["canWrite"], false);
    let read: Value = app
        .client
        .get(format!("{}{server}/files/content?path=notes.txt", app.base))
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    assert_eq!(read["canWrite"], false);
    for (action, body) in [
        ("mkdir", json!({"path":"no"})),
        ("move", json!({"from":"notes.txt","to":"moved"})),
        ("copy", json!({"from":"notes.txt","to":"copy"})),
        ("delete", json!({"path":"notes.txt","recursive":false})),
    ] {
        let response = app
            .post(&format!("{server}/files/{action}"))
            .json(&body)
            .send()
            .await?;
        assert_eq!(response.status(), 409, "{action}");
        let problem: Value = response.json().await?;
        assert_eq!(problem["code"], "files.server_running");
    }
    assert_eq!(
        put(&app, &format!("{server}/files/content?path=notes.txt"))
            .json(&json!({"content":"changed","etag":read["etag"]}))
            .send()
            .await?
            .status(),
        409
    );
    assert_eq!(
        app.post(&format!("{server}/files/upload?path=no"))
            .body("no")
            .send()
            .await?
            .status(),
        409
    );
    app.close().await
}

#[tokio::test]
async fn editor_accepts_one_mebibyte_with_json_escaping_beyond_default_limit() -> Result {
    let app = TestApp::with_auth(false).await?;
    let (id, _) = create(&app).await?;
    let route = format!("/api/v1/servers/{id}/files/content?path=escaped.txt");
    let content = "\t".repeat(mcm_core::files::TEXT_LIMIT as usize);
    assert_eq!(
        put(&app, &route)
            .json(&json!({"content":content,"etag":null}))
            .send()
            .await?
            .status(),
        200
    );
    let too_big = "x".repeat(mcm_core::files::TEXT_LIMIT as usize + 1);
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
    assert!(matches!(result, Err(mcm_core::server::ServerError::Busy)));
    // Wait for worker cleanup via the same public lock rather than a fixed sleep.
    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        loop {
            match app.backend.state.files.list(&id, String::new()).await {
                Err(mcm_core::files::FileError::Server(mcm_core::server::ServerError::Busy)) => {
                    tokio::task::yield_now().await
                }
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
