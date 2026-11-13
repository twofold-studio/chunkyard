use crate::{Database, storage};
use async_trait::async_trait;
use mcm_core::{
    repository::RepositoryError,
    server::{Server, ServerError, ServerRepo},
};
use sqlx::SqlitePool;
#[derive(Clone)]
pub struct SqliteServerRepo {
    pool: SqlitePool,
}
impl SqliteServerRepo {
    pub fn new(database: &Database) -> Self {
        Self {
            pool: database.pool.clone(),
        }
    }
}
#[async_trait]
impl ServerRepo for SqliteServerRepo {
    async fn insert(&self, server: &Server) -> Result<(), ServerError> {
        let document = serde_json::to_string(server).map_err(storage)?;
        sqlx::query("INSERT INTO servers(id, port, document) VALUES (?, ?, ?)")
            .bind(&server.id)
            .bind(server.port as i64)
            .bind(document)
            .execute(&self.pool)
            .await
            .map_err(|error| {
                if error
                    .as_database_error()
                    .is_some_and(|e| e.is_unique_violation())
                {
                    ServerError::PortInUse
                } else {
                    ServerError::Storage(storage(error))
                }
            })?;
        Ok(())
    }
    async fn set_eula(&self, id: &str, accepted: bool) -> Result<(), RepositoryError> {
        sqlx::query("UPDATE servers SET document = json_set(document, '$.acceptEula', json(?)) WHERE id = ?")
            .bind(if accepted { "true" } else { "false" }).bind(id).execute(&self.pool).await.map_err(storage)?;
        Ok(())
    }
    async fn get(&self, id: &str) -> Result<Option<Server>, RepositoryError> {
        let json: Option<String> = sqlx::query_scalar("SELECT document FROM servers WHERE id = ?")
            .bind(id)
            .fetch_optional(&self.pool)
            .await
            .map_err(storage)?;
        json.map(|s| serde_json::from_str(&s).map_err(storage))
            .transpose()
    }
    async fn list(&self) -> Result<Vec<Server>, RepositoryError> {
        let rows: Vec<String> = sqlx::query_scalar("SELECT document FROM servers ORDER BY id")
            .fetch_all(&self.pool)
            .await
            .map_err(storage)?;
        rows.iter()
            .map(|s| serde_json::from_str(s).map_err(storage))
            .collect()
    }
}
