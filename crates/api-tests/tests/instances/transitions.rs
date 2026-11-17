use crate::common;
use chunkyard_core::server::{ArchiveReference, Server, ServerRepo, ServerService};
use serde_json::{Value, json};
use std::sync::Arc;
type Result<T = ()> = std::result::Result<T, Box<dyn std::error::Error>>;

#[tokio::test]
async fn startup_recovers_archive_and_restore_publication_boundaries() -> Result {
    let app = common::TestApp::with_auth(false).await?;
    let repo = Arc::new(chunkyard_db::SqliteServerRepo::new(&app.backend.database));
    let root = app.directory.path().join("servers");
    let manager = chunkyard_process::ServerManager::new(
        root.clone(),
        "fixture".into(),
        repo.clone(),
        Arc::new(common::runtime::FakeRuntime::default()),
    );
    for (kind, committed) in [
        ("archive", false),
        ("archive", true),
        ("restore", false),
        ("restore", true),
    ] {
        let created: Value = app
            .post("/api/v1/servers")
            .json(&json!({"name":"Recovery fixture"}))
            .send()
            .await?
            .json()
            .await?;
        let mut server: Server = serde_json::from_value(created["server"].clone())?;
        let local = root.join(&server.id);
        std::fs::write(local.join("world.dat"), b"preserve my world")?;
        let reference = Some(ArchiveReference {
            export_id: uuid::Uuid::new_v4().to_string(),
            archived_at: "2026-11-14T00:00:00Z".into(),
        });
        let (staging, previous, next) = if kind == "archive" {
            let name = format!(".chunkyard-archive-{}", server.id);
            std::fs::rename(&local, root.join(&name))?;
            if committed {
                server.archive = reference.clone();
            }
            (name, None, reference)
        } else {
            server.archive = if committed { None } else { reference.clone() };
            // Simulate publication followed by a process crash before/after metadata commit.
            (
                format!(".chunkyard-restore-{}", uuid::Uuid::new_v4().simple()),
                reference,
                None,
            )
        };
        repo.save(&server).await?;
        let journal = root.join(format!(".chunkyard-transition-{}.json", server.id));
        std::fs::write(
            &journal,
            serde_json::to_vec(
                &json!({"id":server.id,"kind":kind,"staging":staging,"previous":previous,"next":next}),
            )?,
        )?;
        assert!(matches!(
            manager.start(&server.id).await,
            Err(chunkyard_core::server::ServerError::Busy)
        ));
        manager.recover_transitions().await?;
        assert!(!journal.exists());
        assert!(!root.join(staging).exists());
        let should_be_local = (kind == "archive" && !committed) || (kind == "restore" && committed);
        assert_eq!(local.exists(), should_be_local);
        if should_be_local {
            assert_eq!(
                std::fs::read(local.join("world.dat"))?,
                b"preserve my world"
            );
        }
    }
    manager.shutdown().await;
    app.close().await
}

#[tokio::test]
async fn malformed_journal_never_touches_paths_outside_manager_staging() -> Result {
    let app = common::TestApp::with_auth(false).await?;
    let created: Value = app
        .post("/api/v1/servers")
        .json(&json!({"name":"Protected world"}))
        .send()
        .await?
        .json()
        .await?;
    let id = created["server"]["id"].as_str().ok_or("id")?;
    let outside = app.directory.path().join("outside");
    std::fs::create_dir(&outside)?;
    std::fs::write(outside.join("important"), b"keep")?;
    let root = app.directory.path().join("servers");
    let journal = root.join(format!(".chunkyard-transition-{id}.json"));
    std::fs::write(
        &journal,
        serde_json::to_vec(
            &json!({"id":id,"kind":"archive","staging":"../outside","previous":null,"next":{"exportId":"fake","archivedAt":"now"}}),
        )?,
    )?;
    let manager = chunkyard_process::ServerManager::new(
        root,
        "fixture".into(),
        Arc::new(chunkyard_db::SqliteServerRepo::new(&app.backend.database)),
        Arc::new(common::runtime::FakeRuntime::default()),
    );
    assert!(manager.recover_transitions().await.is_err());
    assert!(journal.exists());
    assert_eq!(std::fs::read(outside.join("important"))?, b"keep");
    manager.shutdown().await;
    app.close().await
}
