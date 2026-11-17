//! Persistent authentication records. Secrets are deliberately not serializable or Debug.
use crate::repository::RepositoryError;
use async_trait::async_trait;
use serde::Serialize;

#[derive(Clone, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct User {
    #[schema(required = true)]
    pub id: String,
    #[schema(required = true)]
    pub email: String,
    #[schema(required = true)]
    pub role: String,
    #[schema(required = true)]
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

/// Public metadata only. The bearer secret is never stored or returned here.
#[derive(Clone, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ApiKey {
    #[schema(required = true)]
    pub id: String,
    #[schema(required = true)]
    pub name: String,
    #[schema(required = true)]
    pub prefix: String,
    #[schema(required = true)]
    pub created_at: String,
    #[schema(required = true)]
    pub last_used_at: Option<String>,
}

pub struct NewApiKey {
    pub key: ApiKey,
    pub hash: String,
    pub user_id: Option<String>,
}
pub struct ApiKeyIdentity {
    pub user: Option<User>,
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
    async fn create_api_key(&self, record: &NewApiKey) -> Result<bool, RepositoryError>;
    async fn api_keys(&self) -> Result<Vec<ApiKey>, RepositoryError>;
    async fn revoke_api_key(&self, id: &str) -> Result<(), RepositoryError>;
    /// Returns the owner identity for account-bound keys, or None for trusted-mode keys.
    async fn api_key(
        &self,
        hash: &str,
        now: i64,
        trusted: bool,
    ) -> Result<Option<ApiKeyIdentity>, RepositoryError>;
}

/// Requests in trusted-network mode have no account or stored session.
#[derive(Clone)]
pub enum Actor {
    Session(Session),
    ApiKey(Option<User>),
    AuthDisabled,
}
impl Actor {
    pub fn user_id(&self) -> Option<&str> {
        match self {
            Self::Session(session) => Some(&session.user.id),
            Self::ApiKey(user) => user.as_ref().map(|user| user.id.as_str()),
            Self::AuthDisabled => None,
        }
    }
}
