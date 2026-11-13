use sqlx::{
    SqlitePool,
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions},
};
use std::{path::Path, str::FromStr, time::Duration};
#[derive(Debug, thiserror::Error)]
pub enum DatabaseError {
    #[error(transparent)]
    Sql(#[from] sqlx::Error),
    #[error(transparent)]
    Migration(#[from] sqlx::migrate::MigrateError),
}
/// One shared pool per daemon; opening also applies pending migrations.
#[derive(Clone)]
pub struct Database {
    pub(crate) pool: SqlitePool,
}
impl Database {
    pub async fn open(path: &Path) -> Result<Self, DatabaseError> {
        let options = SqliteConnectOptions::from_str("sqlite:")?
            .filename(path)
            .create_if_missing(true)
            .journal_mode(SqliteJournalMode::Wal)
            .foreign_keys(true)
            .busy_timeout(Duration::from_secs(5));
        let pool = SqlitePoolOptions::new()
            .max_connections(4)
            .connect_with(options)
            .await?;
        sqlx::migrate!().run(&pool).await?;
        Ok(Self { pool })
    }
    pub async fn healthy(&self) -> bool {
        sqlx::query_scalar::<_, i64>("SELECT 1")
            .fetch_one(&self.pool)
            .await
            .is_ok()
    }
    pub async fn close(&self) {
        self.pool.close().await;
    }
}

#[async_trait::async_trait]
impl mcm_core::system::HealthCheck for Database {
    async fn healthy(&self) -> bool {
        Database::healthy(self).await
    }
}
