use crate::{Database, DatabaseError};
use async_trait::async_trait;
use mcm_core::java::{JavaRuntime, JavaRuntimeRepo, RepositoryError};
use sqlx::SqlitePool;
use std::path::Path;
#[derive(Clone)]
pub struct SqliteJavaRuntimeRepo {
    pool: SqlitePool,
}
impl SqliteJavaRuntimeRepo {
    pub fn new(database: &Database) -> Self {
        Self {
            pool: database.pool.clone(),
        }
    }
    pub async fn open(path: &Path) -> Result<Self, DatabaseError> {
        Ok(Self::new(&Database::open(path).await?))
    }
}
fn storage(error: impl std::fmt::Display) -> RepositoryError {
    RepositoryError(error.to_string())
}
fn path_text(runtime: &JavaRuntime) -> Result<&str, RepositoryError> {
    runtime
        .path
        .to_str()
        .ok_or_else(|| storage("Java path is not valid Unicode"))
}

#[async_trait]
impl JavaRuntimeRepo for SqliteJavaRuntimeRepo {
    async fn list(&self) -> Result<Vec<JavaRuntime>, RepositoryError> {
        let rows: Vec<String> =
            sqlx::query_scalar("SELECT document FROM java_runtimes ORDER BY path")
                .fetch_all(&self.pool)
                .await
                .map_err(storage)?;
        rows.into_iter()
            .map(|s| serde_json::from_str(&s).map_err(storage))
            .collect()
    }
    async fn upsert(&self, runtime: &JavaRuntime) -> Result<(), RepositoryError> {
        let mut tx = self
            .pool
            .begin_with("BEGIN IMMEDIATE")
            .await
            .map_err(storage)?;
        let mut runtime = runtime.clone();
        let existing: Option<String> =
            sqlx::query_scalar("SELECT document FROM java_runtimes WHERE path = ?")
                .bind(path_text(&runtime)?)
                .fetch_optional(&mut *tx)
                .await
                .map_err(storage)?;
        if let Some(existing) = existing {
            let existing: JavaRuntime = serde_json::from_str(&existing).map_err(storage)?;
            runtime.id = existing.id;
        }
        sqlx::query("INSERT INTO java_runtimes(path, id, managed, document) VALUES (?, ?, ?, ?) ON CONFLICT(path) DO UPDATE SET managed = excluded.managed, document = excluded.document")
            .bind(path_text(&runtime)?).bind(runtime.id.0.to_string()).bind(runtime.managed).bind(serde_json::to_string(&runtime).map_err(storage)?)
            .execute(&mut *tx).await.map_err(storage)?;
        tx.commit().await.map_err(storage)?;
        Ok(())
    }
    async fn replace_system(&self, runtimes: &[JavaRuntime]) -> Result<(), RepositoryError> {
        let mut tx = self
            .pool
            .begin_with("BEGIN IMMEDIATE")
            .await
            .map_err(storage)?;
        let rows: Vec<String> = sqlx::query_scalar("SELECT document FROM java_runtimes")
            .fetch_all(&mut *tx)
            .await
            .map_err(storage)?;
        let existing: Vec<JavaRuntime> = rows
            .iter()
            .map(|s| serde_json::from_str(s).map_err(storage))
            .collect::<Result<_, _>>()?;
        sqlx::query("DELETE FROM java_runtimes WHERE managed = 0")
            .execute(&mut *tx)
            .await
            .map_err(storage)?;
        for runtime in runtimes {
            if runtime.managed {
                return Err(storage("system refresh cannot add managed runtimes"));
            }
            let previous = existing.iter().find(|r| r.path == runtime.path);
            if previous.is_some_and(|r| r.managed) {
                continue;
            }
            let mut runtime = runtime.clone();
            if let Some(previous) = previous {
                runtime.id = previous.id;
            }
            sqlx::query(
                "INSERT INTO java_runtimes(path, id, managed, document) VALUES (?, ?, 0, ?)",
            )
            .bind(path_text(&runtime)?)
            .bind(runtime.id.0.to_string())
            .bind(serde_json::to_string(&runtime).map_err(storage)?)
            .execute(&mut *tx)
            .await
            .map_err(storage)?;
        }
        tx.commit().await.map_err(storage)?;
        Ok(())
    }
}
