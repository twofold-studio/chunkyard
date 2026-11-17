use chunkyard_core::jobs::{Job, JobError, JobRepo, JobService, JobState};
use chunkyard_db::{Database, SqliteJobRepo};
use chunkyard_jobs::JobManager;
use serde_json::json;
use std::sync::Arc;
type Result<T = ()> = std::result::Result<T, Box<dyn std::error::Error>>;

#[tokio::test]
async fn progress_is_durable_while_running_and_retained_at_completion() -> Result {
    use chunkyard_core::progress::{ProgressReporter, Stage};
    let dir = tempfile::tempdir()?;
    let db = Database::open(&dir.path().join("test.db")).await?;
    let repo = Arc::new(SqliteJobRepo::new(&db));
    let manager = JobManager::new(repo.clone(), 1).await?;
    let progress = ProgressReporter::default();
    progress.stage(Stage::Resolve);
    let worker = progress.clone();
    let (release, wait) = tokio::sync::oneshot::channel();
    let job = manager
        .submit_progress_for_server(
            "server.install",
            "fixture",
            None,
            Box::pin(async move {
                worker.bytes(Stage::Download, Some(10), Some(100));
                let _ = wait.await;
                worker.stage(Stage::Finalize);
                Ok(json!({"ok":true}))
            }),
            progress,
        )
        .await?;
    for _ in 0..200 {
        if repo
            .get(&job.id)
            .await?
            .and_then(|j| j.work)
            .is_some_and(|w| w.stage == Stage::Download)
        {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    let active = repo.get(&job.id).await?.ok_or("job")?;
    assert_eq!(active.state, JobState::Running);
    assert!(
        active.progress.is_none(),
        "Stage bytes must not invent an overall percentage"
    );
    let work = active.work.ok_or("Missing persisted progress")?;
    assert_eq!(
        (work.completed_bytes, work.total_bytes),
        (Some(10), Some(100))
    );
    assert_eq!(work.completed_stages, vec![Stage::Resolve]);
    release.send(()).map_err(|_| "worker stopped")?;
    for _ in 0..200 {
        if repo
            .get(&job.id)
            .await?
            .is_some_and(|j| j.state == JobState::Succeeded)
        {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    let done = repo.get(&job.id).await?.ok_or("job")?;
    assert_eq!(done.state, JobState::Succeeded);
    assert_eq!(done.work.ok_or("progress")?.stage, Stage::Finalize);
    manager.shutdown().await;
    db.close().await;
    Ok(())
}

#[tokio::test]
async fn startup_marks_interrupted_jobs_failed_and_preserves_completed_jobs() -> Result {
    let dir = tempfile::tempdir()?;
    let db = Database::open(&dir.path().join("test.db")).await?;
    let repo = Arc::new(SqliteJobRepo::new(&db));
    for (id, state) in [
        ("queued", JobState::Queued),
        ("running", JobState::Running),
        ("done", JobState::Succeeded),
    ] {
        repo.insert(&Job {
            id: id.into(),
            kind: "test".into(),
            server_id: None,
            state,
            progress: None,
            work: None,
            message: None,
            error: None,
            result: None,
            created_by: None,
            created_at: "2026-01-01T00:00:00Z".into(),
            started_at: None,
            finished_at: None,
        })
        .await?;
    }
    let manager = JobManager::new(repo.clone(), 2).await?;
    for id in ["queued", "running"] {
        let job = repo.get(id).await?.ok_or("job missing")?;
        assert_eq!(job.state, JobState::Failed);
        assert_eq!(job.error.ok_or("error missing")?.code, "job.interrupted");
    }
    assert_eq!(
        repo.get("done").await?.ok_or("job missing")?.state,
        JobState::Succeeded
    );
    manager.shutdown().await;
    db.close().await;
    Ok(())
}

#[tokio::test]
async fn executor_bounds_concurrency_and_flushes_interrupted_work_on_shutdown() -> Result {
    let dir = tempfile::tempdir()?;
    let db = Database::open(&dir.path().join("test.db")).await?;
    let repo = Arc::new(SqliteJobRepo::new(&db));
    let manager = JobManager::new(repo.clone(), 1).await?;
    let job = manager
        .submit("test", Some("owner"), Box::pin(std::future::pending()))
        .await?;
    assert!(matches!(
        manager
            .submit("test", Some("owner"), Box::pin(async { Ok(json!({})) }))
            .await,
        Err(JobError::Busy)
    ));
    manager.shutdown().await;
    let interrupted = repo.get(&job.id).await?.ok_or("job missing")?;
    assert_eq!(interrupted.state, JobState::Failed);
    assert_eq!(
        interrupted.error.ok_or("error missing")?.code,
        "job.interrupted"
    );
    assert!(matches!(
        manager
            .submit("test", Some("owner"), Box::pin(async { Ok(json!({})) }))
            .await,
        Err(JobError::Busy)
    ));
    db.close().await;
    Ok(())
}

#[tokio::test]
async fn a_panicking_task_fails_its_job_without_breaking_the_executor() -> Result {
    let dir = tempfile::tempdir()?;
    let db = Database::open(&dir.path().join("test.db")).await?;
    let repo = Arc::new(SqliteJobRepo::new(&db));
    let manager = JobManager::new(repo.clone(), 2).await?;
    let job = manager
        .submit(
            "test",
            Some("owner"),
            Box::pin(async { panic!("simulated worker failure") }),
        )
        .await?;
    for _ in 0..100 {
        if repo
            .get(&job.id)
            .await?
            .is_some_and(|job| job.state == JobState::Failed)
        {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(5)).await;
    }
    let failed = repo.get(&job.id).await?.ok_or("job missing")?;
    assert_eq!(failed.error.ok_or("error missing")?.code, "job.panicked");
    manager
        .submit("test", Some("owner"), Box::pin(async { Ok(json!({})) }))
        .await?;
    manager.shutdown().await;
    db.close().await;
    Ok(())
}

#[tokio::test]
async fn keyset_pagination_has_no_duplicates_and_rejects_invalid_cursors() -> Result {
    let dir = tempfile::tempdir()?;
    let db = Database::open(&dir.path().join("test.db")).await?;
    let repo = Arc::new(SqliteJobRepo::new(&db));
    for index in 1..=5 {
        repo.insert(&Job {
            id: format!("00000000-0000-4000-8000-{index:012}"),
            kind: "test".into(),
            server_id: None,
            state: JobState::Succeeded,
            progress: Some(1.0),
            work: None,
            message: None,
            error: None,
            result: None,
            created_by: None,
            created_at: "2026-01-01T00:00:00Z".into(),
            started_at: None,
            finished_at: None,
        })
        .await?;
    }
    let manager = JobManager::new(repo, 1).await?;
    let first = manager.list(2, None).await?;
    let second = manager.list(2, first.next_cursor.as_deref()).await?;
    let third = manager.list(2, second.next_cursor.as_deref()).await?;
    let ids: Vec<_> = first
        .items
        .iter()
        .chain(&second.items)
        .chain(&third.items)
        .map(|j| j.id.clone())
        .collect();
    assert_eq!(ids.len(), 5);
    assert_eq!(
        ids.iter().collect::<std::collections::HashSet<_>>().len(),
        5
    );
    assert!(third.next_cursor.is_none());
    assert!(matches!(
        manager.list(2, Some("not base64!")).await,
        Err(JobError::InvalidCursor)
    ));
    manager.shutdown().await;
    db.close().await;
    Ok(())
}
