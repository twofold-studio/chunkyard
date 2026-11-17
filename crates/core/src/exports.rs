//! Portable instance archives and private S3 storage connections.
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::{io, pin::Pin};

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ExportScope {
    World,
    Selected,
    All,
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ExportDestination {
    Local,
    S3,
}
#[derive(Clone, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExportRequest {
    pub scope: ExportScope,
    #[serde(default)]
    pub paths: Vec<String>,
    pub destination: ExportDestination,
}
#[derive(Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ArchiveRequest {
    pub export_id: String,
    #[serde(default)]
    pub confirm_discard_changes: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Export {
    #[schema(required = true)]
    pub id: String,
    #[schema(required = true)]
    pub server_id: String,
    #[schema(required = true)]
    pub server_name: String,
    #[schema(required = true)]
    pub scope: ExportScope,
    #[schema(required = true)]
    pub destination: ExportDestination,
    #[schema(required = true)]
    pub created_at: String,
    #[schema(required = true)]
    pub size: u64,
    #[schema(required = true)]
    pub sha256: String,
    #[schema(required = true)]
    pub file_name: String,
    #[schema(required = true)]
    pub object_key: Option<String>,
}
// Deliberately no Debug implementation: this contains a credential.
#[derive(Clone, Serialize, Deserialize, Default, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StorageConnection {
    pub endpoint: String,
    pub region: String,
    pub bucket: String,
    #[serde(default)]
    pub prefix: String,
    pub access_key_id: String,
    #[serde(default)]
    pub secret_access_key: Option<String>,
}
#[derive(Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct StorageView {
    #[schema(required = true)]
    pub configured: bool,
    #[schema(required = true)]
    pub endpoint: String,
    #[schema(required = true)]
    pub region: String,
    #[schema(required = true)]
    pub bucket: String,
    #[schema(required = true)]
    pub prefix: String,
    #[schema(required = true)]
    pub access_key_id: String,
    #[schema(required = true)]
    pub has_secret: bool,
}
pub struct ExportDownload {
    pub name: String,
    pub size: u64,
    pub stream: Pin<Box<dyn futures_util::Stream<Item = Result<Vec<u8>, io::Error>> + Send>>,
}
#[derive(Debug, thiserror::Error)]
pub enum ExportError {
    #[error("A matching verified full S3 backup and explicit confirmation are required.")]
    BackupRequired,
    #[error("Restore is available only for full backups with no local instance files.")]
    RestoreConflict,
    #[error("The backup is corrupt, incompatible or contains unsafe entries.")]
    InvalidArchive,
    #[error("Invalid export selection or storage connection.")]
    Invalid,
    #[error("Export not found.")]
    NotFound,
    #[error("Export exceeds the archive size or entry limit.")]
    Limit,
    #[error("The S3 operation failed. Check the endpoint, credentials and bucket permissions.")]
    Storage,
    #[error(
        "An export or storage operation is busy. Existing S3 archives also prevent changing their storage location or access identity."
    )]
    Busy,
    #[error(transparent)]
    Server(#[from] crate::server::ServerError),
    #[error(transparent)]
    Files(#[from] crate::files::FileError),
    #[error("Export storage could not be read or written.")]
    Io(#[from] io::Error),
}
impl ExportError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::BackupRequired => "exports.backup_required",
            Self::RestoreConflict => "exports.restore_conflict",
            Self::InvalidArchive => "exports.invalid_archive",
            Self::Server(e) => e.code(),
            Self::Files(crate::files::FileError::Running) => "files.server_running",
            Self::Files(crate::files::FileError::TooLarge) => "exports.limit",
            Self::Files(_) => "exports.invalid",
            Self::Invalid => "exports.invalid",
            Self::NotFound => "exports.not_found",
            Self::Limit => "exports.limit",
            Self::Busy => "exports.busy",
            Self::Storage | Self::Io(_) => "exports.storage",
        }
    }
    pub fn public_detail(&self) -> &'static str {
        match self {
            Self::BackupRequired => {
                "A matching verified full S3 backup and explicit confirmation are required. The pinned backup cannot be deleted while the instance is archived."
            }
            Self::RestoreConflict => {
                "Restore requires a full backup and no local instance files. Archive or retain existing files before retrying."
            }
            Self::InvalidArchive => {
                "The backup is corrupt, incompatible or contains unsafe entries. Local files have not been replaced."
            }
            Self::Invalid => "Invalid export selection or storage connection.",
            Self::NotFound => "Export not found.",
            Self::Limit => "Export exceeds the archive size or entry limit.",
            Self::Busy => {
                "An export is busy or existing S3 archives prevent changing their storage location or access identity."
            }
            Self::Server(_) => "The instance is unavailable or busy.",
            Self::Files(_) => {
                "Stop the instance and select valid existing paths without symbolic links."
            }
            Self::Storage | Self::Io(_) => {
                "The storage operation failed. Check the endpoint, credentials, bucket permissions and available disk space."
            }
        }
    }
}
#[async_trait]
pub trait ExportService: Send + Sync {
    async fn get(&self, id: &str) -> Result<Export, ExportError>;
    async fn archive_instance(
        &self,
        server_id: &str,
        request: ArchiveRequest,
        progress: crate::progress::ProgressReporter,
    ) -> Result<crate::server::ServerView, ExportError>;
    async fn restore_instance(
        &self,
        export_id: &str,
        progress: crate::progress::ProgressReporter,
    ) -> Result<crate::server::ServerView, ExportError>;
    async fn create_with_progress(
        &self,
        server_id: &str,
        request: ExportRequest,
        _progress: crate::progress::ProgressReporter,
    ) -> Result<Export, ExportError> {
        self.create(server_id, request).await
    }
    async fn storage(&self) -> Result<StorageView, ExportError>;
    async fn set_storage(&self, connection: StorageConnection) -> Result<StorageView, ExportError>;
    async fn test_storage(&self) -> Result<(), ExportError>;
    async fn list(&self) -> Result<Vec<Export>, ExportError>;
    async fn create(&self, server_id: &str, request: ExportRequest) -> Result<Export, ExportError>;
    async fn download(&self, id: &str) -> Result<ExportDownload, ExportError>;
    async fn delete(&self, id: &str) -> Result<(), ExportError>;
}
