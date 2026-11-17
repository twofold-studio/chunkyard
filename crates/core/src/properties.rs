//! Versioned desired configuration and its last manager-applied runtime revision.
use crate::{
    files::FileError,
    repository::RepositoryError,
    server::{RuntimeStatus, ServerError},
};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};

#[derive(Debug, thiserror::Error)]
pub enum PropertiesError {
    #[error("configuration changed since it was read")]
    Conflict,
    #[error("configuration version does not exist")]
    NotFound,
    #[error("invalid configuration request")]
    Invalid,
    #[error("configuration exceeds the text limit")]
    TooLarge,
    #[error(transparent)]
    File(#[from] FileError),
    #[error(transparent)]
    Server(#[from] ServerError),
    #[error(transparent)]
    Storage(#[from] RepositoryError),
}
#[derive(Clone, Debug, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PropertiesVersion {
    #[schema(required = true)]
    pub version: i64,
    #[schema(required = true)]
    pub etag: String,
    #[schema(required = true)]
    pub created_at: String,
    #[schema(required = true)]
    pub source: String,
}
#[derive(Clone, Debug, Serialize, utoipa::ToSchema)]
pub struct PropertiesRevision {
    #[serde(flatten)]
    #[schema(required = true)]
    pub metadata: PropertiesVersion,
    #[schema(required = true)]
    pub content: String,
}
#[derive(Debug, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PropertiesDocument {
    #[schema(required = true)]
    pub content: String,
    #[schema(required = true)]
    pub etag: String,
    #[schema(required = true)]
    pub version: i64,
    #[schema(required = true)]
    pub applied_version: Option<i64>,
    #[schema(required = true)]
    pub restart_required: bool,
    #[schema(required = true)]
    pub status: RuntimeStatus,
    #[schema(required = true)]
    pub updated_at: String,
}
#[derive(Debug, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PropertiesHistory {
    #[schema(required = true)]
    pub items: Vec<PropertiesVersion>,
    #[schema(required = true)]
    pub next_before: Option<i64>,
}
#[derive(Debug, Deserialize, utoipa::ToSchema)]
#[serde(deny_unknown_fields)]
pub struct PropertiesWrite {
    pub content: String,
    pub etag: String,
}
#[derive(Debug, Deserialize, utoipa::ToSchema)]
#[serde(deny_unknown_fields)]
pub struct PropertiesRestore {
    pub version: i64,
    pub etag: String,
}
#[derive(Clone, Debug)]
pub struct AppliedProperties {
    pub version: i64,
    pub etag: String,
    pub runtime_identity: String,
}
#[derive(Default)]
pub struct PropertiesState {
    pub desired: Option<PropertiesRevision>,
    pub applied: Option<AppliedProperties>,
}
#[async_trait]
pub trait PropertiesRepo: Send + Sync {
    async fn state(&self, id: &str) -> Result<PropertiesState, PropertiesError>;
    async fn append(
        &self,
        id: &str,
        content: &str,
        etag: &str,
        source: &str,
        expected: Option<&str>,
        desired: bool,
    ) -> Result<PropertiesRevision, PropertiesError>;
    async fn set_applied(
        &self,
        id: &str,
        version: Option<i64>,
        identity: Option<&str>,
    ) -> Result<(), PropertiesError>;
    async fn history(
        &self,
        id: &str,
        before: Option<i64>,
        limit: u32,
    ) -> Result<Vec<PropertiesVersion>, PropertiesError>;
    async fn revision(&self, id: &str, version: i64)
    -> Result<PropertiesRevision, PropertiesError>;
}
#[async_trait]
pub trait PropertiesService: Send + Sync {
    async fn properties(&self, id: &str) -> Result<PropertiesDocument, PropertiesError>;
    async fn save_properties(
        &self,
        id: &str,
        request: PropertiesWrite,
    ) -> Result<PropertiesDocument, PropertiesError>;
    async fn properties_history(
        &self,
        id: &str,
        before: Option<i64>,
        limit: u32,
    ) -> Result<PropertiesHistory, PropertiesError>;
    async fn properties_revision(
        &self,
        id: &str,
        version: i64,
    ) -> Result<PropertiesRevision, PropertiesError>;
    async fn restore_properties(
        &self,
        id: &str,
        request: PropertiesRestore,
    ) -> Result<PropertiesDocument, PropertiesError>;
}
