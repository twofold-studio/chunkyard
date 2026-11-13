//! Durable background job contracts; no task executor or storage implementation here.
use crate::repository::RepositoryError;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{future::Future, pin::Pin};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum JobState {
    Queued,
    Running,
    Succeeded,
    Failed,
    Cancelled,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JobFailure {
    pub code: String,
    pub detail: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Job {
    pub id: String,
    pub kind: String,
    pub server_id: Option<String>,
    pub state: JobState,
    pub progress: Option<f64>,
    pub message: Option<String>,
    pub error: Option<JobFailure>,
    pub result: Option<Value>,
    pub created_by: Option<String>,
    pub created_at: String,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobCursor {
    pub created_at: String,
    pub id: String,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobPage {
    pub items: Vec<Job>,
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
    async fn list(&self, limit: u32, cursor: Option<&str>) -> Result<JobPage, JobError>;
}
