use async_trait::async_trait;
use chunkyard_core::jobs::{
    Job, JobCursor, JobError, JobFailure, JobPage, JobRepo, JobService, JobState, JobTask,
};
use futures_util::FutureExt;
use std::{panic::AssertUnwindSafe, sync::Arc};
use tokio::sync::{Mutex, Semaphore};
use tokio_util::{sync::CancellationToken, task::TaskTracker};
use uuid::Uuid;

pub struct JobManager {
    repo: Arc<dyn JobRepo>,
    capacity: Arc<Semaphore>,
    tasks: TaskTracker,
    shutdown: CancellationToken,
    admission: Mutex<()>,
}
impl JobManager {
    pub async fn new(repo: Arc<dyn JobRepo>, capacity: usize) -> Result<Self, JobError> {
        repo.recover(&timestamp()).await?;
        Ok(Self {
            repo,
            capacity: Arc::new(Semaphore::new(capacity)),
            tasks: TaskTracker::new(),
            shutdown: CancellationToken::new(),
            admission: Mutex::new(()),
        })
    }
    async fn submit_inner(
        &self,
        kind: &str,
        server_id: Option<&str>,
        actor: Option<&str>,
        task: JobTask,
        progress: Option<chunkyard_core::progress::ProgressReporter>,
    ) -> Result<Job, JobError> {
        let _guard = self.admission.lock().await;
        if self.shutdown.is_cancelled() {
            return Err(JobError::Busy);
        }
        let permit = self
            .capacity
            .clone()
            .try_acquire_owned()
            .map_err(|_| JobError::Busy)?;
        let job = Job {
            id: Uuid::new_v4().to_string(),
            kind: kind.into(),
            server_id: server_id.map(str::to_owned),
            state: JobState::Queued,
            progress: None,
            work: None,
            message: None,
            error: None,
            result: None,
            created_by: actor.map(str::to_owned),
            created_at: timestamp(),
            started_at: None,
            finished_at: None,
        };
        self.repo.insert(&job).await?;
        let mut running = job.clone();
        let repo = self.repo.clone();
        let shutdown = self.shutdown.clone();
        self.tasks.spawn(async move {
            let _permit = permit;
            running.state = JobState::Running;
            running.started_at = Some(timestamp());
            if let Err(error) = repo.update(&running).await { tracing::error!(%error, job_id = %running.id, "could not start job"); return; }
            let task = AssertUnwindSafe(task).catch_unwind();
            tokio::pin!(task);
            let mut tick = tokio::time::interval(std::time::Duration::from_millis(500));
            tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            let outcome = loop { tokio::select! {
                result = &mut task => break result.unwrap_or_else(|_| Err(JobFailure { code: "job.panicked".into(), detail: "The background operation stopped unexpectedly.".into() })),
                _ = shutdown.cancelled() => break Err(JobFailure { code: "job.interrupted".into(), detail: "The manager stopped before this job completed.".into() }),
                _ = tick.tick(), if progress.is_some() => {
                    let latest = progress.as_ref().and_then(|p| p.snapshot());
                    if latest != running.work {
                        running.work = latest;
                        if let Err(error) = repo.update(&running).await { tracing::warn!(%error, "could not persist job progress"); }
                    }
                }
            }};
            running.work = progress.as_ref().and_then(|p| p.snapshot());
            running.finished_at = Some(timestamp());
            match outcome {
                Ok(result) => { running.state = JobState::Succeeded; running.progress = Some(1.0); running.result = Some(result); }
                Err(error) => { running.state = JobState::Failed; running.error = Some(error); }
            }
            if let Err(error) = repo.update(&running).await { tracing::error!(%error, job_id = %running.id, "could not persist job completion"); }
        });
        Ok(job)
    }
    /// Stop admission, interrupt active work, and flush final job states before closing SQLite.
    pub async fn shutdown(&self) {
        {
            let _guard = self.admission.lock().await;
            self.shutdown.cancel();
            self.tasks.close();
        }
        self.tasks.wait().await;
    }
}
#[async_trait]
impl JobService for JobManager {
    async fn submit(
        &self,
        kind: &str,
        actor: Option<&str>,
        task: JobTask,
    ) -> Result<Job, JobError> {
        self.submit_inner(kind, None, actor, task, None).await
    }
    async fn submit_for_server(
        &self,
        kind: &str,
        server_id: &str,
        actor: Option<&str>,
        task: JobTask,
    ) -> Result<Job, JobError> {
        self.submit_inner(kind, Some(server_id), actor, task, None)
            .await
    }
    async fn submit_progress_for_server(
        &self,
        kind: &str,
        server_id: &str,
        actor: Option<&str>,
        task: JobTask,
        progress: chunkyard_core::progress::ProgressReporter,
    ) -> Result<Job, JobError> {
        self.submit_inner(kind, Some(server_id), actor, task, Some(progress))
            .await
    }
    async fn get(&self, id: &str) -> Result<Option<Job>, JobError> {
        Ok(self.repo.get(id).await?)
    }
    async fn list_filtered(
        &self,
        limit: u32,
        cursor: Option<&str>,
        server_id: Option<&str>,
        active_only: bool,
    ) -> Result<JobPage, JobError> {
        use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
        let cursor: Option<JobCursor> = cursor
            .map(|value| {
                if value.len() > 1024 {
                    return Err(JobError::InvalidCursor);
                }
                let bytes = URL_SAFE_NO_PAD
                    .decode(value)
                    .map_err(|_| JobError::InvalidCursor)?;
                let cursor: JobCursor =
                    serde_json::from_slice(&bytes).map_err(|_| JobError::InvalidCursor)?;
                if cursor.created_at.len() > 64 || uuid::Uuid::parse_str(&cursor.id).is_err() {
                    return Err(JobError::InvalidCursor);
                }
                Ok(cursor)
            })
            .transpose()?;
        let limit = limit.clamp(1, 200) as usize;
        let mut items = self
            .repo
            .list(limit as u32 + 1, cursor.as_ref(), server_id, active_only)
            .await?;
        let next_cursor = if items.len() > limit {
            items.truncate(limit);
            items
                .last()
                .map(|last| {
                    let cursor = JobCursor {
                        created_at: last.created_at.clone(),
                        id: last.id.clone(),
                    };
                    serde_json::to_vec(&cursor)
                        .map(|bytes| URL_SAFE_NO_PAD.encode(bytes))
                        .map_err(|_| JobError::InvalidCursor)
                })
                .transpose()?
        } else {
            None
        };
        Ok(JobPage { items, next_cursor })
    }
}
fn timestamp() -> String {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".into())
}
