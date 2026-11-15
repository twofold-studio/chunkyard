//! Bounded instance exports and an archive catalog independent of server records.
mod instances;
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
        Ok(storage::view(self.connection().await?))
    }
    async fn set_storage(
        &self,
        mut connection: StorageConnection,
    ) -> Result<StorageView, ExportError> {
        connection.prefix = connection.prefix.trim_end_matches('/').to_owned();
        let guard = Arc::new(
            self.operation
                .clone()
                .try_lock_owned()
                .map_err(|_| ExportError::Busy)?,
        );
        let old = self.connection().await?;
        let identity_changed = connection.endpoint != old.endpoint
            || connection.bucket != old.bucket
            || connection.region != old.region
            || connection.prefix != old.prefix
            || connection.access_key_id != old.access_key_id;
        if identity_changed
            && self
                .list()
                .await?
                .iter()
                .any(|e| e.destination == ExportDestination::S3)
        {
            return Err(ExportError::Busy);
        }
        if connection
            .secret_access_key
            .as_deref()
            .is_none_or(str::is_empty)
        {
            if connection.endpoint != old.endpoint || connection.access_key_id != old.access_key_id
            {
                return Err(ExportError::Invalid);
            }
            connection.secret_access_key = old.secret_access_key;
        }
        storage::client(&connection)?;
        let bytes = serde_json::to_vec(&connection).map_err(|_| ExportError::Invalid)?;
        private_write(self.root.join("storage.json"), bytes, guard).await?;
        Ok(storage::view(connection))
    }
    async fn test_storage(&self) -> Result<(), ExportError> {
        let _guard = self.operation.try_lock().map_err(|_| ExportError::Busy)?;
        let connection = self.connection().await?;
        let (bucket, credentials) = storage::client(&connection)?;
        let key = storage::object_key(&connection, &format!("connection-test-{}", Uuid::new_v4()));
        let content = Uuid::new_v4().as_bytes().to_vec();
        use rusty_s3::S3Action;
        let put = bucket
            .put_object(Some(&credentials), &key)
            .sign(storage::EXPIRY);
        let result = async {
            storage::success(self.http.put(put).body(content.clone()).send().await)?;
            let get = bucket
                .get_object(Some(&credentials), &key)
                .sign(storage::EXPIRY);
            let mut response = storage::success(self.http.get(get).send().await)?;
            let mut bytes = Vec::new();
            while let Some(chunk) = response.chunk().await.map_err(|_| ExportError::Storage)? {
                if bytes.len() + chunk.len() > content.len() {
                    return Err(ExportError::Storage);
                }
                bytes.extend_from_slice(&chunk);
            }
            if bytes != content {
                return Err(ExportError::Storage);
            }
            Ok(())
        }
        .await;
        let delete = bucket
            .delete_object(Some(&credentials), &key)
            .sign(storage::EXPIRY);
        let cleanup = storage::success(self.http.delete(delete).send().await).map(|_| ());
        result.and(cleanup)
    }
    async fn list(&self) -> Result<Vec<Export>, ExportError> {
        let mut dir = tokio::fs::read_dir(&self.root).await?;
        let mut records = Vec::new();
        let mut inspected = 0;
        while let Some(entry) = dir.next_entry().await? {
            inspected += 1;
            if inspected > 20_000 {
                return Err(ExportError::Limit);
            }
            let name = entry.file_name();
            let Some(name) = name.to_str() else {
                continue;
            };
            if let Some(id) = name.strip_suffix(".json")
                && Uuid::parse_str(id).is_ok()
            {
                records.push(self.record(id).await?);
            }
        }
        records.sort_by(|a, b| {
            b.created_at
                .cmp(&a.created_at)
                .then_with(|| b.id.cmp(&a.id))
        });
        Ok(records)
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
        let record = self.record(id).await?;
        let stream = if record.destination == ExportDestination::S3 {
            let connection = self.connection().await?;
            let (bucket, credentials) = storage::client(&connection)?;
            let key = record.object_key.as_deref().ok_or(ExportError::Storage)?;
            use rusty_s3::S3Action;
            let url = bucket
                .get_object(Some(&credentials), key)
                .sign(storage::EXPIRY);
            let response = storage::success(self.http.get(url).send().await)?;
            if response.content_length() != Some(record.size) {
                return Err(ExportError::Storage);
            }
            Box::pin(response.bytes_stream().map(|r| {
                r.map(|b| b.to_vec())
                    .map_err(|_| std::io::Error::other("archive transfer interrupted"))
            })) as _
        } else {
            let file = tokio::fs::File::open(self.root.join(&record.file_name)).await?;
            Box::pin(tokio_util::io::ReaderStream::new(file).map(|r| r.map(|b| b.to_vec()))) as _
        };
        Ok(ExportDownload {
            name: record.file_name,
            size: record.size,
            stream,
        })
    }
    async fn delete(&self, id: &str) -> Result<(), ExportError> {
        let _guard = self.operation.try_lock().map_err(|_| ExportError::Busy)?;
        let record = self.record(id).await?;
        if self
            .servers
            .repo
            .list()
            .await
            .map_err(chunkyard_core::server::ServerError::Storage)?
            .iter()
            .any(|server| {
                server
                    .archive
                    .as_ref()
                    .is_some_and(|archive| archive.export_id == record.id)
            })
        {
            return Err(ExportError::BackupRequired);
        }
        if record.destination == ExportDestination::S3 {
            let connection = self.connection().await?;
            let (bucket, credentials) = storage::client(&connection)?;
            use rusty_s3::S3Action;
            let key = record.object_key.as_deref().ok_or(ExportError::Storage)?;
            storage::success(
                self.http
                    .delete(
                        bucket
                            .delete_object(Some(&credentials), key)
                            .sign(storage::EXPIRY),
                    )
                    .send()
                    .await,
            )?;
        } else {
            match tokio::fs::remove_file(self.root.join(&record.file_name)).await {
                Ok(()) => (),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
                Err(e) => return Err(e.into()),
            }
        }
        tokio::fs::remove_file(self.root.join(format!("{}.json", record.id))).await?;
        Ok(())
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

impl ExportManager {
    async fn create_archive(
        &self,
        server_id: &str,
        request: ExportRequest,
        progress: chunkyard_core::progress::ProgressReporter,
    ) -> Result<Export, ExportError> {
        if (request.scope == ExportScope::Selected
            && (request.paths.is_empty() || request.paths.len() > 100))
            || (request.scope != ExportScope::Selected && !request.paths.is_empty())
        {
            return Err(ExportError::Invalid);
        }
        let operation = Arc::new(
            self.operation
                .clone()
                .try_lock_owned()
                .map_err(|_| ExportError::Busy)?,
        );
        let connection = self.connection().await?;
        if request.destination == ExportDestination::S3 {
            storage::client(&connection)?;
        }
        let server = self.servers.local_record(server_id).await?;
        let guard = Arc::new(
            self.servers
                .lock(&server.id)?
                .try_lock_owned()
                .map_err(|_| chunkyard_core::server::ServerError::Busy)?,
        );
        let server = self.servers.local_record(&server.id).await?;
        if self.servers.runtime.status(&server).await?.state != ServerState::Stopped {
            return Err(chunkyard_core::files::FileError::Running.into());
        }
        let desired = if let Some(repo) = &self.servers.properties_repo {
            repo.state(&server.id)
                .await
                .map_err(|_| ExportError::Storage)?
                .desired
                .map(|v| v.content)
        } else {
            None
        };
        let manifest = serde_json::to_vec_pretty(&serde_json::json!({"formatVersion":1,"server":server,"properties":"Latest saved configuration, applied on next start. EULA is not transferable acceptance."})).map_err(|_| ExportError::Invalid)?;
        let id = Uuid::new_v4().to_string();
        let mut record = Export {
            id: id.clone(),
            server_id: server.id.clone(),
            server_name: server.name.clone(),
            scope: request.scope,
            destination: request.destination,
            created_at: timestamp(),
            size: 0,
            sha256: String::new(),
            file_name: format!("chunkyard-{id}.tar.gz"),
            object_key: None,
        };
        let root = self.servers.root.clone();
        let exports = self.root.clone();
        let worker_operation = operation.clone();
        let worker_guard = guard.clone();
        let archive_progress = progress.clone();
        let (temp, size, hash) = tokio::task::spawn_blocking(move || -> Result<_, ExportError> {
            let _operation = worker_operation;
            let _guard = worker_guard;
            let temp = tempfile::Builder::new()
                .prefix(".export-")
                .tempfile_in(exports)?;
            let fs = chunkyard_fs::sandbox::Sandbox::open(&root, &server.id)?;
            let (size, hash) = fs
                .export_archive_with_progress(
                    &request.paths,
                    request.scope == ExportScope::World,
                    temp.reopen()?,
                    &manifest,
                    desired.as_deref(),
                    archive_progress,
                )
                .map_err(|e| match e {
                    chunkyard_core::files::FileError::TooLarge => ExportError::Limit,
                    chunkyard_core::files::FileError::Io(ref io)
                        if io.kind() == std::io::ErrorKind::FileTooLarge =>
                    {
                        ExportError::Limit
                    }
                    other => ExportError::Files(other),
                })?;
            Ok((temp, size, hash))
        })
        .await
        .map_err(|_| std::io::Error::other("archive worker failed"))??;
        record.size = size;
        record.sha256 = hash;
        if record.destination == ExportDestination::S3 {
            let key = storage::object_key(&connection, &record.file_name);
            self.upload_verified(
                &connection,
                &key,
                temp.path(),
                size,
                &record.sha256,
                progress.clone(),
            )
            .await?;
            record.object_key = Some(key);
        } else {
            // Atomic publication; UUIDs make collisions impossible without corrupted storage.
            temp.persist_noclobber(self.root.join(&record.file_name))
                .map_err(|e| e.error)?;
        }
        progress.stage(chunkyard_core::progress::Stage::Finalize);
        let bytes = serde_json::to_vec(&record).map_err(|_| ExportError::Invalid)?;
        private_write(
            self.root.join(format!("{}.json", record.id)),
            bytes,
            operation,
        )
        .await?;
        Ok(record)
    }
}
