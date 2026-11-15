mod common;
use chunkyard_core::jobs::{Job, JobRepo, JobState};
use chunkyard_db::SqliteJobRepo;
use common::TestApp;
use serde_json::Value;
type Result<T = ()> = std::result::Result<T, Box<dyn std::error::Error>>;

#[tokio::test]
async fn server_and_active_job_filters_preserve_keyset_pagination_and_deleted_server_history()
-> Result {
    let app = TestApp::with_auth(false).await?;
    let repo = SqliteJobRepo::new(&app.backend.database);
    let server = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    let other = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    for (index, server_id, state) in [
        (1, Some(server), JobState::Running),
        (2, Some(server), JobState::Succeeded),
        (3, Some(server), JobState::Queued),
        (4, Some(other), JobState::Running),
        (5, None, JobState::Running),
        (6, Some(server), JobState::Succeeded),
    ] {
        repo.insert(&Job {
            id: format!("00000000-0000-4000-8000-{index:012}"),
            kind: "server.install".into(),
            server_id: server_id.map(str::to_owned),
            state,
            progress: None,
            work: None,
            message: None,
            error: None,
            result: None,
            created_by: None,
            created_at: "2026-11-14T00:00:00Z".into(),
            started_at: None,
            finished_at: None,
        })
        .await?;
    }
    // These server records do not exist; their durable history remains queryable.
    let mut cursor = None;
    let mut ids = Vec::new();
    loop {
        let mut request = app
            .client
            .get(format!("{}/api/v1/jobs", app.base))
            .query(&[("serverId", server.to_uppercase()), ("limit", "2".into())]);
        if let Some(value) = &cursor {
            request = request.query(&[("cursor", value)]);
        }
        let page: Value = request.send().await?.error_for_status()?.json().await?;
        for job in page["items"].as_array().ok_or("items")? {
            assert_eq!(job["serverId"], server);
            ids.push(job["id"].as_str().ok_or("job id")?.to_owned());
        }
        cursor = page["nextCursor"].as_str().map(str::to_owned);
        if cursor.is_none() {
            break;
        }
    }
    assert_eq!(ids.len(), 4);
    assert_eq!(
        ids.iter().collect::<std::collections::HashSet<_>>().len(),
        4
    );
    let active: Value = app
        .client
        .get(format!("{}/api/v1/jobs", app.base))
        .query(&[("serverId", server), ("activeOnly", "true")])
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    let jobs = active["items"].as_array().ok_or("items")?;
    assert_eq!(jobs.len(), 2);
    assert!(jobs.iter().all(|job| job["serverId"] == server
        && matches!(job["state"].as_str(), Some("running" | "queued"))));
    let global: Value = app
        .client
        .get(format!("{}/api/v1/jobs?activeOnly=true", app.base))
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    assert_eq!(global["items"].as_array().ok_or("items")?.len(), 4);
    for query in [
        "serverId=invalid",
        "activeOnly=maybe",
        "serverId=",
        "unknown=true",
    ] {
        assert_eq!(
            app.client
                .get(format!("{}/api/v1/jobs?{query}", app.base))
                .send()
                .await?
                .status(),
            400
        );
    }
    app.close().await
}
