use crate::{Database, storage};
use async_trait::async_trait;
use chunkyard_core::properties::*;
use sqlx::{FromRow, SqlitePool};

pub struct SqlitePropertiesRepo {
    pool: SqlitePool,
}
impl SqlitePropertiesRepo {
    pub fn new(database: &Database) -> Self {
        Self {
            pool: database.pool.clone(),
        }
    }
}
#[derive(FromRow)]
struct RevisionRow {
    version: i64,
    etag: String,
    created_at: String,
    source: String,
    content: String,
}
impl From<RevisionRow> for PropertiesRevision {
    fn from(row: RevisionRow) -> Self {
        Self {
            metadata: PropertiesVersion {
                version: row.version,
                etag: row.etag,
                created_at: row.created_at,
                source: row.source,
            },
            content: row.content,
        }
    }
}
#[async_trait]
impl PropertiesRepo for SqlitePropertiesRepo {
    async fn state(&self, id: &str) -> Result<PropertiesState, PropertiesError> {
        let state: Option<(Option<i64>,Option<i64>,Option<String>)> = sqlx::query_as("SELECT desired_version,applied_version,runtime_identity FROM server_properties_state WHERE server_id=?")
            .bind(id).fetch_optional(&self.pool).await.map_err(storage)?;
        let Some((desired, applied, identity)) = state else {
            return Ok(PropertiesState::default());
        };
        let desired = match desired {
            Some(v) => Some(self.revision(id, v).await?),
            None => None,
        };
        let applied = match (applied, identity) {
            (Some(version), Some(runtime_identity)) => {
                let etag = sqlx::query_scalar(
                    "SELECT etag FROM server_properties_versions WHERE server_id=? AND version=?",
                )
                .bind(id)
                .bind(version)
                .fetch_one(&self.pool)
                .await
                .map_err(storage)?;
                Some(AppliedProperties {
                    version,
                    etag,
                    runtime_identity,
                })
            }
            _ => None,
        };
        Ok(PropertiesState { desired, applied })
    }
    async fn append(
        &self,
        id: &str,
        content: &str,
        etag: &str,
        source: &str,
        expected: Option<&str>,
        desired: bool,
    ) -> Result<PropertiesRevision, PropertiesError> {
        // Reserve SQLite's writer before checking the etag; concurrent instances
        // cannot turn a read-then-write upgrade into SQLITE_BUSY_SNAPSHOT.
        let mut tx = self
            .pool
            .begin_with("BEGIN IMMEDIATE")
            .await
            .map_err(storage)?;
        sqlx::query(
            "INSERT INTO server_properties_state(server_id) VALUES(?) ON CONFLICT DO NOTHING",
        )
        .bind(id)
        .execute(&mut *tx)
        .await
        .map_err(storage)?;
        if desired {
            let current: Option<RevisionRow> = sqlx::query_as("SELECT v.version,v.etag,v.created_at,v.source,v.content FROM server_properties_state s JOIN server_properties_versions v ON v.server_id=s.server_id AND v.version=s.desired_version WHERE s.server_id=?")
                .bind(id).fetch_optional(&mut *tx).await.map_err(storage)?;
            if current.as_ref().map(|v| v.etag.as_str()) != expected {
                return Err(PropertiesError::Conflict);
            }
            if source != "restore"
                && let Some(current) = current
                && current.content == content
            {
                tx.commit().await.map_err(storage)?;
                return Ok(current.into());
            }
        }
        let row:RevisionRow = sqlx::query_as("INSERT INTO server_properties_versions(server_id,version,etag,content,source,created_at) SELECT ?,COALESCE(MAX(version),0)+1,?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM server_properties_versions WHERE server_id=? RETURNING version,etag,content,source,created_at")
            .bind(id).bind(etag).bind(content).bind(source).bind(id).fetch_one(&mut *tx).await.map_err(storage)?;
        if desired {
            sqlx::query("UPDATE server_properties_state SET desired_version=? WHERE server_id=?")
                .bind(row.version)
                .bind(id)
                .execute(&mut *tx)
                .await
                .map_err(storage)?;
        }
        tx.commit().await.map_err(storage)?;
        Ok(row.into())
    }
    async fn set_applied(
        &self,
        id: &str,
        version: Option<i64>,
        identity: Option<&str>,
    ) -> Result<(), PropertiesError> {
        sqlx::query("UPDATE server_properties_state SET applied_version=?,runtime_identity=? WHERE server_id=?").bind(version).bind(identity).bind(id).execute(&self.pool).await.map_err(storage)?;
        Ok(())
    }
    async fn history(
        &self,
        id: &str,
        before: Option<i64>,
        limit: u32,
    ) -> Result<Vec<PropertiesVersion>, PropertiesError> {
        let rows:Vec<(i64,String,String,String)> = sqlx::query_as("SELECT version,etag,created_at,source FROM server_properties_versions WHERE server_id=? AND (? IS NULL OR version<?) ORDER BY version DESC LIMIT ?")
            .bind(id).bind(before).bind(before).bind(limit).fetch_all(&self.pool).await.map_err(storage)?;
        Ok(rows
            .into_iter()
            .map(|(version, etag, created_at, source)| PropertiesVersion {
                version,
                etag,
                created_at,
                source,
            })
            .collect())
    }
    async fn revision(
        &self,
        id: &str,
        version: i64,
    ) -> Result<PropertiesRevision, PropertiesError> {
        let row:Option<RevisionRow> = sqlx::query_as("SELECT version,etag,created_at,source,content FROM server_properties_versions WHERE server_id=? AND version=?").bind(id).bind(version).fetch_optional(&self.pool).await.map_err(storage)?;
        row.map(Into::into).ok_or(PropertiesError::NotFound)
    }
}
