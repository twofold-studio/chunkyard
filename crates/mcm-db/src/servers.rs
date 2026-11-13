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
    async fn set_network(
        &self,
        id: &str,
        port: u16,
        publish_ip: Option<std::net::IpAddr>,
    ) -> Result<(), RepositoryError> {
        let ip = serde_json::to_string(&publish_ip).map_err(storage)?;
        sqlx::query("UPDATE servers SET port=?, document=json_set(document,'$.port',?,'$.publishIp',json(?)) WHERE id=?")
            .bind(i64::from(port)).bind(i64::from(port)).bind(ip).bind(id)
            .execute(&self.pool).await.map_err(storage)?;
        Ok(())
    }
    async fn delete(&self, id: &str) -> Result<(), RepositoryError> {
        sqlx::query("DELETE FROM servers WHERE id=?")
            .bind(id)
            .execute(&self.pool)
            .await
            .map_err(storage)?;
        Ok(())
    }
    async fn insert(&self, server: &Server) -> Result<(), ServerError> {
        let document = serde_json::to_string(server).map_err(storage)?;
        sqlx::query("INSERT INTO servers(id, port, document) VALUES (?, ?, ?)")
            .bind(&server.id)
            .bind(server.port as i64)
            .bind(document)
            .execute(&self.pool)
            .await
            .map_err(|error| ServerError::Storage(storage(error)))?;
        Ok(())
    }
    async fn set_eula(&self, id: &str, accepted: bool) -> Result<(), RepositoryError> {
        sqlx::query("UPDATE servers SET document = json_set(document, '$.acceptEula', json(?)) WHERE id = ?")
            .bind(if accepted { "true" } else { "false" }).bind(id).execute(&self.pool).await.map_err(storage)?;
        Ok(())
    }
    async fn set_installation(
        &self,
        id: &str,
        launch: &mcm_core::software::Launch,
        image: &str,
    ) -> Result<(), RepositoryError> {
        let document = serde_json::to_string(launch).map_err(storage)?;
        sqlx::query("UPDATE servers SET document=json_set(document,'$.launch',json(?),'$.dockerImage',?,'$.jar',?) WHERE id=?")
            .bind(document).bind(image).bind(&launch.path).bind(id).execute(&self.pool).await.map_err(storage)?;
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

#[cfg(test)]
mod tests {
    #[tokio::test]
    async fn shared_port_migration_preserves_existing_records_and_allows_duplicates()
    -> Result<(), Box<dyn std::error::Error>> {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await?;
        sqlx::raw_sql(include_str!("../migrations/0004_servers.sql"))
            .execute(&pool)
            .await?;
        sqlx::query(
            "INSERT INTO servers VALUES ('existing', 25565, '{\"name\":\"Existing world\"}')",
        )
        .execute(&pool)
        .await?;
        sqlx::raw_sql(include_str!("../migrations/0005_shared_server_ports.sql"))
            .execute(&pool)
            .await?;
        sqlx::query("INSERT INTO servers VALUES ('second', 25565, '{}')")
            .execute(&pool)
            .await?;
        let preserved: String =
            sqlx::query_scalar("SELECT document FROM servers WHERE id='existing'")
                .fetch_one(&pool)
                .await?;
        assert_eq!(preserved, "{\"name\":\"Existing world\"}");
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM servers WHERE port=25565")
            .fetch_one(&pool)
            .await?;
        assert_eq!(count, 2);
        pool.close().await;
        Ok(())
    }
}
