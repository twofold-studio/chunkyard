use crate::{Database, storage};
use async_trait::async_trait;
use mcm_core::{
    java::RepositoryError,
    jobs::{Job, JobCursor, JobFailure, JobRepo, JobState},
};
use sqlx::SqlitePool;
#[derive(Clone)]
pub struct SqliteJobRepo {
    pool: SqlitePool,
}
impl SqliteJobRepo {
    pub fn new(database: &Database) -> Self {
        Self {
            pool: database.pool.clone(),
        }
    }
}
fn state(job: &Job) -> &'static str {
    match job.state {
        JobState::Queued => "queued",
        JobState::Running => "running",
        JobState::Succeeded => "succeeded",
        JobState::Failed => "failed",
        JobState::Cancelled => "cancelled",
    }
}
#[async_trait]
impl JobRepo for SqliteJobRepo {
    async fn insert(&self, job: &Job) -> Result<(), RepositoryError> {
        sqlx::query("INSERT INTO jobs(id, state, created_at, document) VALUES (?, ?, ?, ?)")
            .bind(&job.id)
            .bind(state(job))
            .bind(&job.created_at)
            .bind(serde_json::to_string(job).map_err(storage)?)
            .execute(&self.pool)
            .await
            .map_err(storage)?;
        Ok(())
    }
    async fn update(&self, job: &Job) -> Result<(), RepositoryError> {
        sqlx::query("UPDATE jobs SET state = ?, document = ? WHERE id = ?")
            .bind(state(job))
            .bind(serde_json::to_string(job).map_err(storage)?)
            .bind(&job.id)
            .execute(&self.pool)
            .await
            .map_err(storage)?;
        Ok(())
    }
    async fn get(&self, id: &str) -> Result<Option<Job>, RepositoryError> {
        let json: Option<String> = sqlx::query_scalar("SELECT document FROM jobs WHERE id = ?")
            .bind(id)
            .fetch_optional(&self.pool)
            .await
            .map_err(storage)?;
        json.map(|s| serde_json::from_str(&s).map_err(storage))
            .transpose()
    }
    async fn list(
        &self,
        limit: u32,
        cursor: Option<&JobCursor>,
    ) -> Result<Vec<Job>, RepositoryError> {
        let rows: Vec<String> = if let Some(cursor) = cursor {
            sqlx::query_scalar("SELECT document FROM jobs WHERE (created_at, id) < (?, ?) ORDER BY created_at DESC, id DESC LIMIT ?")
                .bind(&cursor.created_at).bind(&cursor.id).bind(limit.min(201)).fetch_all(&self.pool).await.map_err(storage)?
        } else {
            sqlx::query_scalar(
                "SELECT document FROM jobs ORDER BY created_at DESC, id DESC LIMIT ?",
            )
            .bind(limit.min(201))
            .fetch_all(&self.pool)
            .await
            .map_err(storage)?
        };
        rows.iter()
            .map(|s| serde_json::from_str(s).map_err(storage))
            .collect()
    }
    async fn recover(&self, finished_at: &str) -> Result<(), RepositoryError> {
        let mut tx = self
            .pool
            .begin_with("BEGIN IMMEDIATE")
            .await
            .map_err(storage)?;
        let rows: Vec<String> =
            sqlx::query_scalar("SELECT document FROM jobs WHERE state IN ('queued', 'running')")
                .fetch_all(&mut *tx)
                .await
                .map_err(storage)?;
        for json in rows {
            let mut job: Job = serde_json::from_str(&json).map_err(storage)?;
            job.state = JobState::Failed;
            job.error = Some(JobFailure {
                code: "job.interrupted".into(),
                detail: "The manager stopped before this job completed.".into(),
            });
            job.finished_at = Some(finished_at.into());
            sqlx::query("UPDATE jobs SET state = 'failed', document = ? WHERE id = ?")
                .bind(serde_json::to_string(&job).map_err(storage)?)
                .bind(&job.id)
                .execute(&mut *tx)
                .await
                .map_err(storage)?;
        }
        tx.commit().await.map_err(storage)?;
        Ok(())
    }
}
