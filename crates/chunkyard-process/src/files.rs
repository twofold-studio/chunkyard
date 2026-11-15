use crate::ServerManager;
use async_trait::async_trait;
use chunkyard_core::{
    files::*,
    properties::{PropertiesService, PropertiesWrite},
    server::{ServerError, ServerState},
};
use chunkyard_fs::sandbox::Sandbox;

impl ServerManager {
    async fn with_files<T, F>(&self, id: &str, write: bool, operation: F) -> Result<T, FileError>
    where
        T: Send + 'static,
        F: FnOnce(Sandbox, bool) -> Result<T, FileError> + Send + 'static,
    {
        let server = self.local_record(id).await?;
        let lock = self.lock(&server.id)?;
        let guard = if write {
            lock.try_lock_owned().map_err(|_| ServerError::Busy)?
        } else {
            // The browser may refresh the directory and open its editor together.
            // Queue reads rather than treating these harmless requests as a conflict.
            lock.lock_owned().await
        };
        let server = self.local_record(id).await?;
        let can_write = match self.runtime.status(&server).await {
            Ok(status) => status.state == ServerState::Stopped,
            Err(ServerError::DockerUnavailable) if !write => false,
            Err(error) => return Err(error.into()),
        };
        if write && !can_write {
            return Err(FileError::Running);
        }
        let root = self.root.clone();
        tokio::task::spawn_blocking(move || {
            // Cancellation of the HTTP future must not release the lifecycle lock
            // while a blocking upload/copy is still changing the instance directory.
            let _guard = guard;
            operation(Sandbox::open(&root, &server.id)?, can_write)
        })
        .await
        .map_err(|_| FileError::Io(std::io::Error::other("file worker failed")))?
    }
}
#[async_trait]
impl FileService for ServerManager {
    async fn list(&self, id: &str, path: String) -> Result<FileListing, FileError> {
        self.with_files(id, false, move |fs, writable| fs.list(path, writable))
            .await
    }
    async fn content(&self, id: &str, path: String) -> Result<FileContent, FileError> {
        if is_properties(&path) {
            let doc = self
                .properties(id)
                .await
                .map_err(crate::properties::file_error)?;
            let size = doc.content.len() as u64;
            return Ok(FileContent {
                path,
                content: doc.content,
                etag: doc.etag,
                size,
                read_only: false,
                can_write: true,
            });
        }
        self.with_files(id, false, move |fs, writable| fs.content(path, writable))
            .await
    }
    async fn save(
        &self,
        id: &str,
        path: String,
        request: WriteContent,
    ) -> Result<SavedFile, FileError> {
        if is_properties(&path) {
            let etag = request.etag.ok_or(FileError::Conflict)?;
            let doc = self
                .save_properties(
                    id,
                    PropertiesWrite {
                        content: request.content,
                        etag,
                    },
                )
                .await
                .map_err(crate::properties::file_error)?;
            return Ok(SavedFile {
                path,
                etag: doc.etag,
                size: doc.content.len() as u64,
            });
        }
        self.with_files(id, true, move |fs, _| fs.save(path, request))
            .await
    }
    async fn download(&self, id: &str, path: String) -> Result<Download, FileError> {
        if is_properties(&path) {
            let content = self
                .properties(id)
                .await
                .map_err(crate::properties::file_error)?
                .content;
            return tokio::task::spawn_blocking(move || {
                use std::io::{Seek, Write};
                let mut file = tempfile::tempfile()?;
                file.write_all(content.as_bytes())?;
                file.rewind()?;
                Ok(Download {
                    file,
                    name: "server.properties".into(),
                    size: content.len() as u64,
                })
            })
            .await
            .map_err(|_| FileError::Io(std::io::Error::other("download worker failed")))?;
        }
        self.with_files(id, false, move |fs, _| fs.download(path))
            .await
    }
    async fn upload(
        &self,
        id: &str,
        path: String,
        overwrite: bool,
        source: Upload,
    ) -> Result<FileEntry, FileError> {
        if is_properties(&path) {
            return Err(FileError::Protected);
        }
        self.with_files(id, true, move |fs, _| fs.upload(path, overwrite, source))
            .await
    }
    async fn mkdir(&self, id: &str, path: String) -> Result<FileEntry, FileError> {
        if is_properties(&path) {
            return Err(FileError::Protected);
        }
        self.with_files(id, true, move |fs, _| fs.mkdir(path)).await
    }
    async fn transfer(
        &self,
        id: &str,
        request: Transfer,
        copy: bool,
    ) -> Result<FileEntry, FileError> {
        if is_properties(&request.from) || is_properties(&request.to) {
            return Err(FileError::Protected);
        }
        self.with_files(id, true, move |fs, _| fs.transfer(request, copy))
            .await
    }
    async fn delete(&self, id: &str, path: String, recursive: bool) -> Result<(), FileError> {
        if is_properties(&path) {
            return Err(FileError::Protected);
        }
        self.with_files(id, true, move |fs, _| fs.delete(path, recursive))
            .await
    }
}
fn is_properties(path: &str) -> bool {
    path.eq_ignore_ascii_case("server.properties")
}
