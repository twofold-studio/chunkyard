//! Durable background job contracts; no task executor or storage implementation here.
use crate::repository::RepositoryError;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{future::Future, pin::Pin};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum JobState {
    Queued,
    Running,
    Succeeded,
    Failed,
    Cancelled,
}
#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
pub struct JobFailure {
    pub code: String,
    pub detail: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Job {
    #[schema(required = true)]
    pub id: String,
    #[schema(required = true)]
    pub kind: String,
    #[schema(required = true)]
    pub server_id: Option<String>,
    #[schema(required = true)]
    pub state: JobState,
    #[schema(required = true)]
    pub progress: Option<f64>,
    #[serde(default)]
    #[schema(required = true)]
    pub work: Option<crate::progress::WorkProgress>,
    #[schema(required = true)]
    pub message: Option<String>,
    #[schema(required = true)]
    pub error: Option<JobFailure>,
    #[schema(required = true)]
    pub result: Option<Value>,
    #[schema(required = true)]
    pub created_by: Option<String>,
    #[schema(required = true)]
    pub created_at: String,
    #[schema(required = true)]
    pub started_at: Option<String>,
    #[schema(required = true)]
    pub finished_at: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct JobCursor {
    pub created_at: String,
    pub id: String,
}
#[derive(Debug, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct JobPage {
    #[schema(required = true)]
    pub items: Vec<Job>,
    #[schema(required = true)]
    pub next_cursor: Option<String>,
}
pub type JobTask = Pin<Box<dyn Future<Output = Result<Value, JobFailure>> + Send + 'static>>;

#[async_trait]
pub trait JobRepo: Send + Sync {
    async fn insert(&self, job: &Job) -> Result<(), RepositoryError>;
    async fn update(&self, job: &Job) -> Result<(), RepositoryError>;
    async fn get(&self, id: &str) -> Result<Option<Job>, RepositoryError>;
    async fn list(
        &self,
        limit: u32,
        cursor: Option<&JobCursor>,
        server_id: Option<&str>,
        active_only: bool,
    ) -> Result<Vec<Job>, RepositoryError>;
    async fn recover(&self, finished_at: &str) -> Result<(), RepositoryError>;
}
#[derive(Debug, thiserror::Error)]
pub enum JobError {
    #[error("background job capacity reached or executor shutting down")]
    Busy,
    #[error("invalid job pagination cursor")]
    InvalidCursor,
    #[error(transparent)]
    Storage(#[from] RepositoryError),
}
#[async_trait]
pub trait JobService: Send + Sync {
    async fn submit_progress_for_server(
        &self,
        kind: &str,
        server_id: &str,
        actor: Option<&str>,
        task: JobTask,
        _progress: crate::progress::ProgressReporter,
    ) -> Result<Job, JobError> {
        self.submit_for_server(kind, server_id, actor, task).await
    }
    async fn submit(&self, kind: &str, actor: Option<&str>, task: JobTask)
    -> Result<Job, JobError>;
    async fn submit_for_server(
        &self,
        kind: &str,
        server_id: &str,
        actor: Option<&str>,
        task: JobTask,
    ) -> Result<Job, JobError>;
    async fn get(&self, id: &str) -> Result<Option<Job>, JobError>;
    async fn list(&self, limit: u32, cursor: Option<&str>) -> Result<JobPage, JobError> {
        self.list_filtered(limit, cursor, None, false).await
    }
    async fn list_filtered(
        &self,
        limit: u32,
        cursor: Option<&str>,
        server_id: Option<&str>,
        active_only: bool,
    ) -> Result<JobPage, JobError>;
}
