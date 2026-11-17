use crate::{Database, storage};
use async_trait::async_trait;
use chunkyard_core::{operations::*, repository::RepositoryError};
use serde_json::Value;
use sqlx::{Row, SqlitePool};

pub struct SqliteOperationsRepo {
    pool: SqlitePool,
}
impl SqliteOperationsRepo {
    pub fn new(database: &Database) -> Self {
        Self {
            pool: database.pool.clone(),
        }
    }
}
#[async_trait]
impl OperationsRepo for SqliteOperationsRepo {
    async fn load(&self, id: &str) -> Result<AutomationState, RepositoryError> {
        let doc: Option<String> =
            sqlx::query_scalar("SELECT document FROM server_operations WHERE server_id=?")
                .bind(id)
                .fetch_optional(&self.pool)
                .await
                .map_err(storage)?;
        doc.map(|s| serde_json::from_str(&s).map_err(storage))
            .unwrap_or_else(|| Ok(AutomationState::default()))
    }
    async fn patch(&self, id: &str, patch: Value) -> Result<(), RepositoryError> {
        sqlx::query("INSERT INTO server_operations(server_id,document) VALUES (?,?) ON CONFLICT(server_id) DO UPDATE SET document=json_patch(server_operations.document,excluded.document)")
            .bind(id).bind(patch.to_string()).execute(&self.pool).await.map_err(storage)?;
        Ok(())
    }
    async fn patch_if_running(&self, id: &str, patch: Value) -> Result<(), RepositoryError> {
        sqlx::query("UPDATE server_operations SET document=json_patch(document,?) WHERE server_id=? AND json_extract(document,'$.desiredRunning')=1")
            .bind(patch.to_string()).bind(id).execute(&self.pool).await.map_err(storage)?;
        Ok(())
    }
    async fn metric(&self, id: &str, point: &HistoryPoint) -> Result<(), RepositoryError> {
        sqlx::query(
            "INSERT OR IGNORE INTO metric_history(server_id,sampled_at,document) VALUES (?,?,?)",
        )
        .bind(id)
        .bind(point.sampled_at)
        .bind(serde_json::to_string(point).map_err(storage)?)
        .execute(&self.pool)
        .await
        .map_err(storage)?;
        Ok(())
    }
    async fn claim_start(
        &self,
        id: &str,
        intent_at: i64,
        patch: Value,
    ) -> Result<bool, RepositoryError> {
        let result = sqlx::query("UPDATE server_operations SET document=json_patch(document,?) WHERE server_id=? AND COALESCE(json_extract(document,'$.intentAt'),0)=?")
            .bind(patch.to_string()).bind(id).bind(intent_at).execute(&self.pool).await.map_err(storage)?;
        Ok(result.rows_affected() == 1)
    }
    async fn history(&self, id: &str, since: i64) -> Result<Vec<HistoryPoint>, RepositoryError> {
        let rows=sqlx::query("SELECT document FROM metric_history WHERE server_id=? AND sampled_at>=? ORDER BY sampled_at LIMIT 10081")
            .bind(id).bind(since).fetch_all(&self.pool).await.map_err(storage)?;
        rows.into_iter()
            .map(|row| serde_json::from_str(row.get::<&str, _>("document")).map_err(storage))
            .collect()
    }
    async fn prune_history(&self, before: i64) -> Result<(), RepositoryError> {
        let mut tx = self.pool.begin().await.map_err(storage)?;
        sqlx::query("DELETE FROM metric_history WHERE sampled_at<?")
            .bind(before)
            .execute(&mut *tx)
            .await
            .map_err(storage)?;
        sqlx::query("DELETE FROM metric_history WHERE rowid IN (SELECT rowid FROM metric_history ORDER BY sampled_at DESC LIMIT -1 OFFSET 100000)").execute(&mut *tx).await.map_err(storage)?;
        tx.commit().await.map_err(storage)?;
        Ok(())
    }
    async fn remember_backup(
        &self,
        id: &str,
        export_id: &str,
        created_at: i64,
    ) -> Result<(), RepositoryError> {
        sqlx::query("INSERT INTO scheduled_exports(export_id,server_id,created_at) VALUES (?,?,?)")
            .bind(export_id)
            .bind(id)
            .bind(created_at)
            .execute(&self.pool)
            .await
            .map_err(storage)?;
        Ok(())
    }
    async fn scheduled_backups(&self, id: &str) -> Result<Vec<String>, RepositoryError> {
        sqlx::query_scalar("SELECT export_id FROM scheduled_exports WHERE server_id=? ORDER BY created_at DESC,export_id DESC")
            .bind(id).fetch_all(&self.pool).await.map_err(storage)
    }
    async fn forget_backup(&self, export_id: &str) -> Result<(), RepositoryError> {
        sqlx::query("DELETE FROM scheduled_exports WHERE export_id=?")
            .bind(export_id)
            .execute(&self.pool)
            .await
            .map_err(storage)?;
        Ok(())
    }
}
