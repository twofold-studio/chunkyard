//! Instance-relative file operations, independent of HTTP and Docker.
use crate::server::ServerError;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};

pub const TEXT_LIMIT: u64 = 1024 * 1024;
pub const UPLOAD_LIMIT: u64 = 128 * 1024 * 1024;
pub type Upload = Box<dyn std::io::Read + Send>;

#[derive(Debug, thiserror::Error)]
pub enum FileError {
    #[error("invalid relative path")]
    Path,
    #[error("symbolic links cannot be traversed")]
    Symlink,
    #[error("this path is protected")]
    Protected,
    #[error("file does not exist")]
    NotFound,
    #[error("destination already exists")]
    Exists,
    #[error("file changed since it was opened")]
    Conflict,
    #[error("directory is not empty")]
    NotEmpty,
    #[error("stop the server before changing files")]
    Running,
    #[error("operation exceeds file limits")]
    TooLarge,
    #[error("only UTF-8 text files can be edited")]
    Binary,
    #[error("file operation failed")]
    Io(#[source] std::io::Error),
    #[error(transparent)]
    Server(#[from] ServerError),
}
impl From<std::io::Error> for FileError {
    fn from(e: std::io::Error) -> Self {
        use std::io::ErrorKind as K;
        match e.kind() {
            K::NotFound => Self::NotFound,
            K::AlreadyExists => Self::Exists,
            K::DirectoryNotEmpty => Self::NotEmpty,
            _ => Self::Io(e),
        }
    }
}
#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum FileKind {
    File,
    Directory,
    Symlink,
    Other,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub kind: FileKind,
    pub size: u64,
    pub modified_at: Option<String>,
    pub read_only: bool,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileListing {
    pub path: String,
    pub entries: Vec<FileEntry>,
    pub truncated: bool,
    pub can_write: bool,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileContent {
    pub path: String,
    pub content: String,
    pub etag: String,
    pub size: u64,
    pub read_only: bool,
    pub can_write: bool,
}
#[derive(Debug, Serialize)]
pub struct SavedFile {
    pub path: String,
    pub etag: String,
    pub size: u64,
}
pub struct Download {
    pub file: std::fs::File,
    pub name: String,
    pub size: u64,
}
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WriteContent {
    pub content: String,
    pub etag: Option<String>,
}
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Transfer {
    pub from: String,
    pub to: String,
}
#[async_trait]
pub trait FileService: Send + Sync {
    async fn list(&self, id: &str, path: String) -> Result<FileListing, FileError>;
    async fn content(&self, id: &str, path: String) -> Result<FileContent, FileError>;
    async fn save(
        &self,
        id: &str,
        path: String,
        request: WriteContent,
    ) -> Result<SavedFile, FileError>;
    async fn download(&self, id: &str, path: String) -> Result<Download, FileError>;
    async fn upload(
        &self,
        id: &str,
        path: String,
        overwrite: bool,
        source: Upload,
    ) -> Result<FileEntry, FileError>;
    async fn mkdir(&self, id: &str, path: String) -> Result<FileEntry, FileError>;
    async fn transfer(
        &self,
        id: &str,
        request: Transfer,
        copy: bool,
    ) -> Result<FileEntry, FileError>;
    async fn delete(&self, id: &str, path: String, recursive: bool) -> Result<(), FileError>;
}
