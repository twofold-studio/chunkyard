use crate::{Database, storage};
use async_trait::async_trait;
use mcm_core::{
    auth::{AuthRepo, Credentials, NewSession, Session, User},
    java::RepositoryError,
};
use sqlx::{Row, SqlitePool, sqlite::SqliteRow};
const IDLE: i64 = 7 * 86400;
const ABSOLUTE: i64 = 30 * 86400;
#[derive(Clone)]
pub struct SqliteAuthRepo {
    pool: SqlitePool,
}
impl SqliteAuthRepo {
    pub fn new(database: &Database) -> Self {
        Self {
            pool: database.pool.clone(),
        }
    }
}
fn user(row: &SqliteRow) -> Result<User, RepositoryError> {
    Ok(User {
        id: row.try_get("id").map_err(storage)?,
        email: row.try_get("email").map_err(storage)?,
        role: row.try_get("role").map_err(storage)?,
        created_at: row.try_get("created_at").map_err(storage)?,
    })
}
#[async_trait]
impl AuthRepo for SqliteAuthRepo {
    async fn setup_required(&self) -> Result<bool, RepositoryError> {
        sqlx::query_scalar("SELECT NOT EXISTS(SELECT 1 FROM users)")
            .fetch_one(&self.pool)
            .await
            .map_err(storage)
    }
    async fn create_owner(
        &self,
        user: &User,
        password_hash: &str,
        session: &NewSession,
    ) -> Result<bool, RepositoryError> {
        let mut tx = self
            .pool
            .begin_with("BEGIN IMMEDIATE")
            .await
            .map_err(storage)?;
        let empty: bool = sqlx::query_scalar("SELECT NOT EXISTS(SELECT 1 FROM users)")
            .fetch_one(&mut *tx)
            .await
            .map_err(storage)?;
        if !empty {
            return Ok(false);
        }
        sqlx::query("INSERT INTO users(id, email, password_hash, role, created_at) VALUES (?, ?, ?, 'owner', ?)")
            .bind(&user.id).bind(&user.email).bind(password_hash).bind(&user.created_at).execute(&mut *tx).await.map_err(storage)?;
        sqlx::query("INSERT INTO sessions(id_hash, public_id, user_id, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)")
            .bind(&session.hash).bind(&session.public_id).bind(&session.user_id).bind(session.now).bind(session.now).execute(&mut *tx).await.map_err(storage)?;
        tx.commit().await.map_err(storage)?;
        Ok(true)
    }
    async fn credentials(&self, email: &str) -> Result<Option<Credentials>, RepositoryError> {
        let row = sqlx::query("SELECT id, email, role, created_at, password_hash FROM users WHERE email = ? COLLATE NOCASE AND disabled = 0")
            .bind(email).fetch_optional(&self.pool).await.map_err(storage)?;
        row.map(|row| {
            Ok(Credentials {
                user: user(&row)?,
                password_hash: row.try_get("password_hash").map_err(storage)?,
            })
        })
        .transpose()
    }
    async fn create_session(&self, session: &NewSession) -> Result<(), RepositoryError> {
        let mut tx = self
            .pool
            .begin_with("BEGIN IMMEDIATE")
            .await
            .map_err(storage)?;
        sqlx::query("DELETE FROM sessions WHERE last_seen_at <= ? OR created_at <= ?")
            .bind(session.now - IDLE)
            .bind(session.now - ABSOLUTE)
            .execute(&mut *tx)
            .await
            .map_err(storage)?;
        // Cap sessions per user without evicting the current browser during a failed login.
        sqlx::query("DELETE FROM sessions WHERE id_hash IN (SELECT id_hash FROM sessions WHERE user_id = ? ORDER BY created_at DESC, public_id DESC LIMIT -1 OFFSET 99)")
            .bind(&session.user_id).execute(&mut *tx).await.map_err(storage)?;
        sqlx::query("INSERT INTO sessions(id_hash, public_id, user_id, created_at, last_seen_at) SELECT ?, ?, id, ?, ? FROM users WHERE id = ? AND disabled = 0")
            .bind(&session.hash).bind(&session.public_id).bind(session.now).bind(session.now).bind(&session.user_id).execute(&mut *tx).await.map_err(storage)?;
        tx.commit().await.map_err(storage)?;
        Ok(())
    }
    async fn session(&self, hash: &str, now: i64) -> Result<Option<Session>, RepositoryError> {
        let row = sqlx::query("SELECT u.id, u.email, u.role, u.created_at, s.public_id, s.last_seen_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id_hash = ? AND u.disabled = 0 AND s.last_seen_at > ? AND s.created_at > ?")
            .bind(hash).bind(now - IDLE).bind(now - ABSOLUTE).fetch_optional(&self.pool).await.map_err(storage)?;
        let Some(row) = row else {
            return Ok(None);
        };
        let session = Session {
            user: user(&row)?,
            public_id: row.try_get("public_id").map_err(storage)?,
        };
        if row.try_get::<i64, _>("last_seen_at").map_err(storage)? < now - 60 {
            sqlx::query(
                "UPDATE sessions SET last_seen_at = ? WHERE id_hash = ? AND last_seen_at < ?",
            )
            .bind(now)
            .bind(hash)
            .bind(now - 60)
            .execute(&self.pool)
            .await
            .map_err(storage)?;
        }
        Ok(Some(session))
    }
    async fn delete_session(&self, hash: &str) -> Result<(), RepositoryError> {
        sqlx::query("DELETE FROM sessions WHERE id_hash = ?")
            .bind(hash)
            .execute(&self.pool)
            .await
            .map_err(storage)?;
        Ok(())
    }
}
