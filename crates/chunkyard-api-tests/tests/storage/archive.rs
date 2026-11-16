use super::support::{Result, Store, completed, read, remove, save};
use crate::common::TestApp;
use axum::{Router, routing::put};
use serde_json::{Value, json};
use std::sync::atomic::Ordering;

#[tokio::test]
async fn archived_instances_keep_identity_and_restore_verified_worlds_and_configuration() -> Result
{
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
    let endpoint = format!("http://{}", listener.local_addr()?);
    let store = Store::default();
    let router = Router::new()
        .route("/chunkyard/{*key}", put(save).get(read).delete(remove))
        .with_state(store.clone());
    let mock = tokio::spawn(async move { axum::serve(listener, router).await });
    let app = TestApp::with_auth(false).await?;
    app.client.put(format!("{}/api/v1/storage",app.base)).header("Origin",&app.base).header("X-MCM-CSRF","1")
        .json(&json!({"endpoint":endpoint,"bucket":"chunkyard","region":"us-east-1","prefix":"archives","accessKeyId":"fixture","secretAccessKey":"fixture"})).send().await?.error_for_status()?;
    let created: Value = app
        .post("/api/v1/servers")
        .json(&json!({"name":"Keep my world","acceptEula":true}))
        .send()
        .await?
        .json()
        .await?;
    let id = created["server"]["id"].as_str().ok_or("id")?;
    let directory = app.directory.path().join("servers").join(id);
    std::fs::create_dir_all(directory.join("world/region"))?;
    std::fs::write(
        directory.join("world/region/r.0.0.mca"),
        b"unique world bytes",
    )?;
    let properties_url = format!("{}/api/v1/servers/{id}/properties", app.base);
    let properties: Value = app.client.get(&properties_url).send().await?.json().await?;
    let saved: Value = app
        .client
        .put(&properties_url)
        .header("Origin", &app.base)
        .header("X-MCM-CSRF", "1")
        .json(&json!({"etag":properties["etag"],"content":"motd=backup\nserver-port=25565\n"}))
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    let backup = completed(
        &app,
        app.post(&format!("/api/v1/servers/{id}/exports"))
            .json(&json!({"scope":"all","destination":"s3"}))
            .send()
            .await?
            .json()
            .await?,
    )
    .await?;
    assert_eq!(backup["state"], "succeeded", "{backup}");
    let export = backup["result"]["id"].as_str().ok_or("export")?;
    app.client
        .put(&properties_url)
        .header("Origin", &app.base)
        .header("X-MCM-CSRF", "1")
        .json(&json!({"etag":saved["etag"],"content":"motd=newer\n"}))
        .send()
        .await?
        .error_for_status()?;
    app.client
        .patch(format!("{}/api/v1/servers/{id}/resources", app.base))
        .header("Origin", &app.base)
        .header("X-MCM-CSRF", "1")
        .json(&json!({"memoryMinMb":512,"memoryMaxMb":4096,"cpus":3}))
        .send()
        .await?
        .error_for_status()?;
    let request = |confirmed| {
        app.post(&format!("/api/v1/servers/{id}/archive"))
            .json(&json!({"exportId":export,"confirmDiscardChanges":confirmed}))
    };
    let rejected = completed(&app, request(false).send().await?.json().await?).await?;
    assert_eq!(rejected["error"]["code"], "exports.backup_required");
    assert!(directory.is_dir());
    store.corrupt.store(true, Ordering::Relaxed);
    let corrupt = completed(&app, request(true).send().await?.json().await?).await?;
    assert_eq!(corrupt["error"]["code"], "exports.invalid_archive");
    assert!(directory.is_dir());
    store.corrupt.store(false, Ordering::Relaxed);
    // A failed database write must put the original directory back.
    let pool = sqlx::sqlite::SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(
            sqlx::sqlite::SqliteConnectOptions::new().filename(app.directory.path().join("mcm.db")),
        )
        .await?;
    sqlx::raw_sql("CREATE TRIGGER reject_archive BEFORE UPDATE ON servers WHEN json_type(NEW.document,'$.archive')='object' BEGIN SELECT RAISE(ABORT,'fixture save failure'); END;").execute(&pool).await?;
    let failed = completed(&app, request(true).send().await?.json().await?).await?;
    assert_eq!(failed["state"], "failed");
    assert_eq!(
        std::fs::read(directory.join("world/region/r.0.0.mca"))?,
        b"unique world bytes"
    );
    sqlx::raw_sql("DROP TRIGGER reject_archive;")
        .execute(&pool)
        .await?;
    sqlx::raw_sql("CREATE TRIGGER lost_archive_ack AFTER UPDATE ON servers WHEN json_type(NEW.document,'$.archive')='object' BEGIN SELECT RAISE(FAIL,'fixture acknowledgement failure'); END;").execute(&pool).await?;
    let archived = completed(&app, request(true).send().await?.json().await?).await?;
    sqlx::raw_sql("DROP TRIGGER lost_archive_ack;")
        .execute(&pool)
        .await?;
    assert_eq!(archived["state"], "succeeded", "{archived}");
    assert!(!directory.exists());
    assert_eq!(archived["result"]["server"]["archive"]["exportId"], export);
    let listed: Value = app
        .client
        .get(format!("{}/api/v1/servers", app.base))
        .send()
        .await?
        .json()
        .await?;
    assert_eq!(listed["items"][0]["id"], id);
    assert_eq!(
        app.client
            .get(format!("{}/api/v1/servers/{id}/files", app.base))
            .send()
            .await?
            .status(),
        409
    );
    assert_eq!(
        app.client
            .delete(format!("{}/api/v1/exports/{export}", app.base))
            .header("Origin", &app.base)
            .header("X-MCM-CSRF", "1")
            .send()
            .await?
            .status(),
        409
    );
    store.corrupt.store(true, Ordering::Relaxed);
    let failed = completed(
        &app,
        app.post(&format!("/api/v1/exports/{export}/restore"))
            .send()
            .await?
            .json()
            .await?,
    )
    .await?;
    assert_eq!(failed["state"], "failed");
    assert!(!directory.exists());
    store.corrupt.store(false, Ordering::Relaxed);
    let restored = completed(
        &app,
        app.post(&format!("/api/v1/exports/{export}/restore"))
            .send()
            .await?
            .json()
            .await?,
    )
    .await?;
    assert_eq!(restored["state"], "succeeded", "{restored}");
    assert_eq!(restored["result"]["server"]["id"], id);
    assert!(restored["result"]["server"]["archive"].is_null());
    assert_eq!(restored["result"]["server"]["memoryMaxMb"], 4096);
    assert_eq!(restored["result"]["server"]["acceptEula"], true);
    assert_eq!(restored["result"]["server"]["status"]["state"], "stopped");
    assert_eq!(
        std::fs::read(directory.join("world/region/r.0.0.mca"))?,
        b"unique world bytes"
    );
    let properties: Value = app.client.get(&properties_url).send().await?.json().await?;
    assert_eq!(properties["content"], "motd=backup\nserver-port=25565\n");
    assert!(properties["version"].as_i64() > saved["version"].as_i64());
    let refused = completed(
        &app,
        app.post(&format!("/api/v1/exports/{export}/restore"))
            .send()
            .await?
            .json()
            .await?,
    )
    .await?;
    assert_eq!(refused["error"]["code"], "exports.restore_conflict");
    // Hold SQLite's writer after the directory move, then cancel the caller.
    // The tracked publication must retain its locks and finish after the writer releases.
    let mut transaction = pool.begin().await?;
    sqlx::query("UPDATE servers SET port=port WHERE id=?")
        .bind(id)
        .execute(&mut *transaction)
        .await?;
    let service = app.backend.state.exports.clone();
    let archive_id = export.to_owned();
    let instance_id = id.to_owned();
    let caller = tokio::spawn(async move {
        service
            .archive_instance(
                &instance_id,
                chunkyard_core::exports::ArchiveRequest {
                    export_id: archive_id,
                    confirm_discard_changes: true,
                },
                Default::default(),
            )
            .await
    });
    let quarantine = app
        .directory
        .path()
        .join("servers")
        .join(format!(".chunkyard-archive-{id}"));
    for _ in 0..200 {
        if quarantine.is_dir() {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    assert!(
        quarantine.is_dir(),
        "Publication reached the blocked metadata write"
    );
    caller.abort();
    assert!(caller.await.is_err());
    transaction.rollback().await?;
    let mut restored_after_cancel = None;
    for _ in 0..200 {
        match app
            .backend
            .state
            .exports
            .restore_instance(export, Default::default())
            .await
        {
            Ok(server) => {
                restored_after_cancel = Some(server);
                break;
            }
            Err(chunkyard_core::exports::ExportError::Busy) => {
                tokio::time::sleep(std::time::Duration::from_millis(10)).await
            }
            Err(error) => return Err(error.into()),
        }
    }
    assert!(restored_after_cancel.is_some());
    assert_eq!(
        std::fs::read(directory.join("world/region/r.0.0.mca"))?,
        b"unique world bytes"
    );
    // Historical backups of permanently removed instances can recreate their original identity.
    app.backend.state.servers.delete(id, true).await?;
    let recreated = completed(
        &app,
        app.post(&format!("/api/v1/exports/{export}/restore"))
            .send()
            .await?
            .json()
            .await?,
    )
    .await?;
    assert_eq!(recreated["state"], "succeeded", "{recreated}");
    assert_eq!(recreated["result"]["server"]["id"], id);
    assert_eq!(recreated["result"]["server"]["acceptEula"], false);
    assert_eq!(std::fs::read(directory.join("eula.txt"))?, b"eula=false\n");
    app.client
        .delete(format!("{}/api/v1/exports/{export}", app.base))
        .header("Origin", &app.base)
        .header("X-MCM-CSRF", "1")
        .send()
        .await?
        .error_for_status()?;
    pool.close().await;
    app.close().await?;
    mock.abort();
    Ok(())
}
