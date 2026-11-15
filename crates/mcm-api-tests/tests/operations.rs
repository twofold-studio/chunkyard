mod common;
use common::TestApp;
use mcm_core::{operations::*, properties::PropertiesWrite};
use serde_json::{Value, json};
type Result<T = ()> = std::result::Result<T, Box<dyn std::error::Error>>;

#[tokio::test]
async fn policy_defaults_are_safe_and_mutations_require_csrf() -> Result {
    let app = TestApp::with_auth(false).await?;
    let server = app
        .backend
        .state
        .servers
        .create(serde_json::from_value(json!({"name":"Operations"}))?)
        .await?;
    let path = format!("/api/v1/servers/{}/automation", server.server.id);
    let response = app.client.get(format!("{}{path}", app.base)).send().await?;
    assert_eq!(response.status(), 200);
    let policy: Value = response.json().await?;
    assert_eq!(policy["recovery"]["autoStart"], false);
    assert_eq!(policy["recovery"]["restartOnCrash"], false);
    assert_eq!(policy["backup"]["enabled"], false);
    assert!(policy["backup"]["keepLast"].is_null());
    assert_eq!(policy["historyEnabled"], true);
    let target = format!("{}/api/v1/servers/{}/recovery", app.base, server.server.id);
    assert_eq!(
        app.client
            .put(&target)
            .json(&json!({"autoStart":true}))
            .send()
            .await?
            .status(),
        403
    );
    assert_eq!(
        app.client
            .put(&target)
            .header("Origin", &app.base)
            .header("X-MCM-CSRF", "1")
            .json(&json!({"maxAttempts":0}))
            .send()
            .await?
            .status(),
        422
    );
    let backup = app
        .client
        .put(format!(
            "{}/api/v1/servers/{}/backup-schedule",
            app.base, server.server.id
        ))
        .header("Origin", &app.base)
        .header("X-MCM-CSRF", "1")
        .json(&json!({"enabled":false,"intervalMinutes":60,"keepLast":2}))
        .send()
        .await?;
    assert_eq!(backup.status(), 422);
    app.close().await
}

#[tokio::test]
async fn stopped_player_edits_preserve_unknown_fields_and_reject_malformed_files() -> Result {
    let app = TestApp::with_auth(false).await?;
    let server = app
        .backend
        .state
        .servers
        .create(serde_json::from_value(json!({"name":"Players"}))?)
        .await?;
    let id = &server.server.id;
    let doc = app.backend.state.properties.properties(id).await?;
    app.backend
        .state
        .properties
        .save_properties(
            id,
            PropertiesWrite {
                content: "online-mode=false\nwhite-list=false\n".into(),
                etag: doc.etag,
            },
        )
        .await?;
    let change = |list: &str, action: &str| PlayerChange {
        list: list.into(),
        action: action.into(),
        name: "Notch".into(),
        uuid: None,
        level: None,
        reason: None,
    };
    let players = app
        .backend
        .state
        .operations
        .change_player(id, change("whitelist", "add"))
        .await?;
    assert_eq!(
        players.whitelist[0]["uuid"],
        "b50ad385-829d-3141-a216-7e7d7539ba7f"
    );
    std::fs::write(
        server.directory.join("ops.json"),
        r#"[{"uuid":"b50ad385-829d-3141-a216-7e7d7539ba7f","name":"Notch","level":1,"custom":"keep"}]"#,
    )?;
    let mut op = change("operators", "add");
    op.level = Some(3);
    let players = app.backend.state.operations.change_player(id, op).await?;
    assert_eq!(players.operators[0]["custom"], "keep");
    assert_eq!(players.operators[0]["level"], 3);
    assert!(
        app.backend
            .state
            .operations
            .change_player(
                id,
                PlayerChange {
                    name: "Notch\nstop".into(),
                    ..change("whitelist", "add")
                }
            )
            .await
            .is_err()
    );
    std::fs::write(server.directory.join("whitelist.json"), "broken json")?;
    assert!(
        app.backend
            .state
            .operations
            .change_player(id, change("whitelist", "remove"))
            .await
            .is_err()
    );
    assert_eq!(
        std::fs::read_to_string(server.directory.join("whitelist.json"))?,
        "broken json"
    );
    app.close().await
}

#[tokio::test]
async fn history_survives_repository_reopen_and_prunes_expired_points() -> Result {
    let app = TestApp::with_auth(false).await?;
    let server = app
        .backend
        .state
        .servers
        .create(serde_json::from_value(json!({"name":"History"}))?)
        .await?;
    let id = &server.server.id;
    let repo = mcm_db::SqliteOperationsRepo::new(&app.backend.database);
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)?
        .as_secs() as i64;
    for at in [now - 8 * 86400, now - 60, now] {
        repo.metric(
            id,
            &HistoryPoint {
                sampled_at: at,
                cpu_percent: Some(12.0),
                memory_working_set_bytes: Some(4096),
                memory_limit_bytes: Some(8192),
            },
        )
        .await?;
    }
    repo.patch(id, json!({"recovery":{"autoStart":true}}))
        .await?;
    repo.patch(id, json!({"historyEnabled":false})).await?;
    let reopened = mcm_db::SqliteOperationsRepo::new(&app.backend.database);
    assert!(reopened.load(id).await?.recovery.auto_start);
    assert!(!reopened.load(id).await?.history_enabled);
    reopened.prune_history(now - 7 * 86400).await?;
    assert_eq!(reopened.history(id, 0).await?.len(), 2);
    for minute in 0..=1440 {
        repo.metric(
            id,
            &HistoryPoint {
                sampled_at: now - minute * 60,
                cpu_percent: Some(20.0),
                memory_working_set_bytes: Some(4096),
                memory_limit_bytes: Some(8192),
            },
        )
        .await?;
    }
    let response = app
        .client
        .get(format!(
            "{}/api/v1/servers/{id}/metrics/history?hours=24",
            app.base
        ))
        .send()
        .await?;
    assert_eq!(response.status(), 200);
    let history: Value = response.json().await?;
    assert_eq!(history["enabled"], false);
    assert_eq!(history["intervalSeconds"], 60);
    assert!(
        history["items"]
            .as_array()
            .is_some_and(|items| !items.is_empty() && items.len() <= 720)
    );
    assert_eq!(
        app.client
            .get(format!(
                "{}/api/v1/servers/{id}/metrics/history?hours=169",
                app.base
            ))
            .send()
            .await?
            .status(),
        422
    );
    app.close().await
}

fn worker(app: &TestApp) -> Result<std::sync::Arc<mcm_process::Operations>> {
    Ok(std::sync::Arc::new(mcm_process::Operations::new(
        std::sync::Arc::new(mcm_db::SqliteOperationsRepo::new(&app.backend.database)),
        app.backend.state.servers.clone(),
        app.backend.state.files.clone(),
        app.backend.state.properties.clone(),
        app.backend.state.exports.clone(),
        "localhost".into(),
    )?))
}
async fn wait_until(mut test: impl FnMut() -> bool) -> Result {
    tokio::time::timeout(std::time::Duration::from_secs(35), async {
        while !test() {
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        }
    })
    .await?;
    Ok(())
}
#[tokio::test]
async fn crash_recovery_is_bounded_and_manual_stop_cancels_it() -> Result {
    use std::sync::atomic::Ordering::SeqCst;
    let app = TestApp::with_auth(false).await?;
    let server = app
        .backend
        .state
        .servers
        .create(serde_json::from_value(
            json!({"name":"Crash test","acceptEula":true}),
        )?)
        .await?;
    let id = &server.server.id;
    std::fs::write(server.directory.join("server.jar"), "fixture")?;
    let ops = worker(&app)?;
    ops.set_recovery(
        id,
        RecoveryPolicy {
            restart_on_crash: true,
            max_attempts: 2,
            retry_delay_seconds: 5,
            auto_start: false,
        },
    )
    .await?;
    app.backend.state.servers.start(id).await?;
    app.runtime.crash_on_start.store(true, SeqCst);
    app.runtime.crash(id)?;
    ops.start(app.backend.jobs.clone());
    wait_until(|| app.runtime.starts.load(SeqCst) == 3).await?;
    tokio::time::sleep(std::time::Duration::from_secs(6)).await;
    assert_eq!(app.runtime.starts.load(SeqCst), 3);
    assert_eq!(ops.automation(id).await?.restart_attempts, 2);
    app.backend.state.servers.stop(id).await?;
    assert!(!ops.automation(id).await?.desired_running);
    tokio::time::sleep(std::time::Duration::from_secs(6)).await;
    assert_eq!(app.runtime.starts.load(SeqCst), 3);
    ops.shutdown().await;
    app.close().await
}

#[tokio::test]
async fn auto_start_is_opt_in_and_never_accepts_the_eula() -> Result {
    use std::sync::atomic::Ordering::SeqCst;
    let app = TestApp::with_auth(false).await?;
    let server = app
        .backend
        .state
        .servers
        .create(serde_json::from_value(json!({"name":"No consent"}))?)
        .await?;
    std::fs::write(server.directory.join("server.jar"), "fixture")?;
    let ops = worker(&app)?;
    ops.set_recovery(
        &server.server.id,
        RecoveryPolicy {
            auto_start: true,
            ..Default::default()
        },
    )
    .await?;
    ops.start(app.backend.jobs.clone());
    tokio::time::sleep(std::time::Duration::from_secs(2)).await;
    assert_eq!(app.runtime.starts.load(SeqCst), 0);
    assert!(
        !app.backend
            .state
            .servers
            .get(&server.server.id)
            .await?
            .server
            .accept_eula
    );
    let jobs = app
        .backend
        .state
        .jobs
        .list_filtered(10, None, Some(&server.server.id), false)
        .await?;
    assert!(jobs.items.iter().any(|job| {
        job.kind == "server.auto_start"
            && job.error.as_ref().is_some_and(|error| {
                error.code == "minecraft.eula_required" || error.code == "server.eula_required"
            })
    }));
    ops.shutdown().await;
    app.close().await
}

#[tokio::test]
async fn newer_stop_supersedes_a_scheduler_snapshot() -> Result {
    let app = TestApp::with_auth(false).await?;
    let server = app
        .backend
        .state
        .servers
        .create(serde_json::from_value(json!({"name":"Stop wins"}))?)
        .await?;
    let id = &server.server.id;
    let repo = mcm_db::SqliteOperationsRepo::new(&app.backend.database);
    repo.patch(id, json!({"intentAt":1,"desiredRunning":true}))
        .await?;
    let snapshot = repo.load(id).await?;
    repo.patch(id, json!({"intentAt":2,"desiredRunning":false}))
        .await?;
    assert!(
        !repo
            .claim_start(id, snapshot.intent_at, json!({"desiredRunning":true}))
            .await?
    );
    assert!(!repo.load(id).await?.desired_running);
    assert!(app.backend.state.servers.automatic_start(id).await.is_err());
    assert_eq!(
        app.runtime.starts.load(std::sync::atomic::Ordering::SeqCst),
        0
    );
    app.close().await
}
