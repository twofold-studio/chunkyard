//! Bounded instance exports and an archive catalog independent of server records.
mod catalog;
mod create;
mod instances;
mod settings;
mod storage;
use crate::ServerManager;
use async_trait::async_trait;
use chunkyard_core::{exports::*, server::ServerState};
use futures_util::StreamExt;
use sha2::{Digest, Sha256};
use std::{
    path::{Path, PathBuf},
    sync::Arc,
};
use tokio::sync::Mutex;
use uuid::Uuid;

pub struct ExportManager {
    root: PathBuf,
    servers: Arc<ServerManager>,
    // Serializes disk-intensive work and prevents connection changes during upload/deletion.
    operation: Arc<Mutex<()>>,
    http: reqwest::Client,
}
impl ExportManager {
    pub fn new(root: PathBuf, servers: Arc<ServerManager>) -> Result<Self, std::io::Error> {
        std::fs::create_dir_all(&root)?;
        // Crash-abandoned staging files contain no completed archive. Never remove cataloged files.
        for entry in std::fs::read_dir(&root)? {
            let entry = entry?;
            if entry
                .file_name()
                .to_str()
                .is_some_and(|n| n.starts_with(".export-"))
                && entry.file_type()?.is_file()
            {
                std::fs::remove_file(entry.path())?;
            }
        }
        let http = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(std::time::Duration::from_secs(10))
            .read_timeout(std::time::Duration::from_secs(60))
            .timeout(std::time::Duration::from_secs(3600))
            .no_proxy()
            .build()
            .map_err(|_| std::io::Error::other("create storage HTTP client"))?;
        Ok(Self {
            root,
            servers,
            operation: Arc::new(Mutex::new(())),
            http,
        })
    }
    async fn connection(&self) -> Result<StorageConnection, ExportError> {
        match tokio::fs::read(self.root.join("storage.json")).await {
            Ok(bytes) => serde_json::from_slice(&bytes).map_err(|_| ExportError::Storage),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(StorageConnection::default()),
            Err(e) => Err(e.into()),
        }
    }
    async fn record(&self, id: &str) -> Result<Export, ExportError> {
        let id = Uuid::parse_str(id)
            .map_err(|_| ExportError::NotFound)?
            .to_string();
        let bytes = tokio::fs::read(self.root.join(format!("{id}.json")))
            .await
            .map_err(|e| {
                if e.kind() == std::io::ErrorKind::NotFound {
                    ExportError::NotFound
                } else {
                    e.into()
                }
            })?;
        serde_json::from_slice(&bytes)
            .map_err(|_| std::io::Error::other("invalid archive record").into())
    }
}
#[async_trait]
impl ExportService for ExportManager {
    async fn get(&self, id: &str) -> Result<Export, ExportError> {
        self.record(id).await
    }
    async fn archive_instance(
        &self,
        server_id: &str,
        request: ArchiveRequest,
        progress: chunkyard_core::progress::ProgressReporter,
    ) -> Result<chunkyard_core::server::ServerView, ExportError> {
        self.archive_local(server_id, request, progress).await
    }
    async fn restore_instance(
        &self,
        export_id: &str,
        progress: chunkyard_core::progress::ProgressReporter,
    ) -> Result<chunkyard_core::server::ServerView, ExportError> {
        self.restore_archive(export_id, progress).await
    }
    async fn storage(&self) -> Result<StorageView, ExportError> {
        self.storage_inner().await
    }
    async fn set_storage(&self, connection: StorageConnection) -> Result<StorageView, ExportError> {
        self.set_storage_inner(connection).await
    }
    async fn test_storage(&self) -> Result<(), ExportError> {
        self.test_storage_inner().await
    }
    async fn list(&self) -> Result<Vec<Export>, ExportError> {
        self.list_inner().await
    }
    async fn create(&self, server_id: &str, request: ExportRequest) -> Result<Export, ExportError> {
        self.create_archive(server_id, request, Default::default())
            .await
    }
    async fn create_with_progress(
        &self,
        server_id: &str,
        request: ExportRequest,
        progress: chunkyard_core::progress::ProgressReporter,
    ) -> Result<Export, ExportError> {
        self.create_archive(server_id, request, progress).await
    }
    async fn download(&self, id: &str) -> Result<ExportDownload, ExportError> {
        self.download_inner(id).await
    }
    async fn delete(&self, id: &str) -> Result<(), ExportError> {
        self.delete_inner(id).await
    }
}
pub(crate) async fn private_write(
    path: PathBuf,
    bytes: Vec<u8>,
    guard: Arc<tokio::sync::OwnedMutexGuard<()>>,
) -> Result<(), ExportError> {
    tokio::task::spawn_blocking(move || -> Result<(), ExportError> {
        let _guard = guard;
        use std::io::Write;
        let parent = path.parent().ok_or(ExportError::Invalid)?;
        let mut temp = tempfile::Builder::new()
            .prefix(".export-")
            .tempfile_in(parent)?;
        // tempfile creates 0600 files, including the connection secret.
        temp.write_all(&bytes)?;
        temp.as_file().sync_all()?;
        temp.persist(path).map_err(|e| e.error)?;
        Ok(())
    })
    .await
    .map_err(|_| std::io::Error::other("export catalog worker failed"))?
}
fn timestamp() -> String {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_default()
}
