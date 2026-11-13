//! Persistent authentication records. Secrets are deliberately not serializable or Debug.
use crate::repository::RepositoryError;
use async_trait::async_trait;
use serde::Serialize;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct User {
    pub id: String,
    pub email: String,
    pub role: String,
    pub created_at: String,
}
pub struct Credentials {
    pub user: User,
    pub password_hash: String,
}
pub struct NewSession {
    pub hash: String,
    pub public_id: String,
    pub user_id: String,
    pub now: i64,
}
#[derive(Clone)]
pub struct Session {
    pub user: User,
    pub public_id: String,
}

#[async_trait]
pub trait AuthRepo: Send + Sync {
    async fn setup_required(&self) -> Result<bool, RepositoryError>;
    /// Atomically claims an empty instance and creates the owner's first session.
    async fn create_owner(
        &self,
        user: &User,
        password_hash: &str,
        session: &NewSession,
    ) -> Result<bool, RepositoryError>;
    async fn credentials(&self, email: &str) -> Result<Option<Credentials>, RepositoryError>;
    async fn create_session(&self, session: &NewSession) -> Result<(), RepositoryError>;
    async fn session(&self, hash: &str, now: i64) -> Result<Option<Session>, RepositoryError>;
    async fn delete_session(&self, hash: &str) -> Result<(), RepositoryError>;
}

/// Requests in trusted-network mode have no account or stored session.
#[derive(Clone)]
pub enum Actor {
    Session(Session),
    AuthDisabled,
}
impl Actor {
    pub fn user_id(&self) -> Option<&str> {
        match self {
            Self::Session(session) => Some(&session.user.id),
            Self::AuthDisabled => None,
        }
    }
}
