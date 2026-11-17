mod common;

use chunkyard_core::{jobs::JobState, operations::RecoveryPolicy, server::ServerState};
use common::TestApp;
use serde_json::json;
use std::{sync::atomic::Ordering::SeqCst, time::Duration};

type Result<T = ()> = std::result::Result<T, Box<dyn std::error::Error>>;

#[tokio::test]
async fn background_recovery_uses_the_http_services_and_injected_runtime() -> Result {
    let app = TestApp::with_auth(false).await?;
    let server = app
        .backend
        .state
        .servers
        .create(serde_json::from_value(json!({
            "name": "Injected composition",
            "software": { "type": "vanilla", "version": "1.21.4" },
            "acceptEula": true
        }))?)
        .await?;
    let id = &server.server.id;
    // The same injected software must be used by server installation, too.
    let installed = app.backend.state.servers.install(id).await?;
    assert_eq!(
        tokio::fs::read(installed.directory.join(&installed.server.jar)).await?,
        b"fixture"
    );
    app.backend
        .state
        .operations
        .set_recovery(
            id,
            RecoveryPolicy {
                auto_start: true,
                ..Default::default()
            },
        )
        .await?;
    app.backend.start_background();
    app.backend.start_background();

    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            let jobs = app
                .backend
                .state
                .jobs
                .list_filtered(10, None, Some(id), false)
                .await?;
            if jobs.items.iter().any(|job| {
                job.kind == "server.auto_start" && matches!(job.state, JobState::Succeeded)
            }) {
                break Ok::<_, Box<dyn std::error::Error>>(());
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await??;
    assert_eq!(app.runtime.starts.load(SeqCst), 1);
    let response = app
        .client
        .get(format!("{}/api/v1/servers/{id}", app.base))
        .send()
        .await?;
    assert_eq!(response.status(), 200);
    let visible: serde_json::Value = response.json().await?;
    assert_eq!(visible["status"]["state"], "running");
    assert_eq!(
        app.backend.state.servers.get(id).await?.status.state,
        ServerState::Running
    );
    let runtime = app.runtime.clone();
    app.close().await?;
    assert_eq!(runtime.shutdowns.load(SeqCst), 1);
    Ok(())
}

#[tokio::test]
async fn composed_background_worker_never_accepts_eula() -> Result {
    let app = TestApp::with_auth(false).await?;
    let server = app
        .backend
        .state
        .servers
        .create(serde_json::from_value(json!({
            "name": "No consent",
            "software": { "type": "vanilla", "version": "1.21.4" }
        }))?)
        .await?;
    let id = &server.server.id;
    app.backend.state.servers.install(id).await?;
    app.backend
        .state
        .operations
        .set_recovery(
            id,
            RecoveryPolicy {
                auto_start: true,
                ..Default::default()
            },
        )
        .await?;
    app.backend.start_background();
    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            let jobs = app
                .backend
                .state
                .jobs
                .list_filtered(10, None, Some(id), false)
                .await?;
            if let Some(job) = jobs
                .items
                .iter()
                .find(|job| matches!(job.state, JobState::Failed))
            {
                assert_eq!(
                    job.error.as_ref().map(|error| error.code.as_str()),
                    Some("server.eula_required")
                );
                break Ok::<_, Box<dyn std::error::Error>>(());
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await??;
    assert_eq!(app.runtime.starts.load(SeqCst), 0);
    assert!(!app.backend.state.servers.get(id).await?.server.accept_eula);
    assert_eq!(
        tokio::fs::read_to_string(server.directory.join("eula.txt")).await?,
        "eula=false\n"
    );
    app.close().await
}
