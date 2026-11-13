use crate::ServerManager;
use async_trait::async_trait;
use mcm_core::{
    files::*,
    server::{ServerError, ServerState},
};
use mcm_fs::sandbox::Sandbox;

impl ServerManager {
    async fn with_files<T, F>(&self, id: &str, write: bool, operation: F) -> Result<T, FileError>
    where
        T: Send + 'static,
        F: FnOnce(Sandbox, bool) -> Result<T, FileError> + Send + 'static,
    {
        let server = self.record(id).await?;
        let guard = self
            .lock(&server.id)?
            .try_lock_owned()
            .map_err(|_| ServerError::Busy)?;
        let server = self.record(id).await?;
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
        self.with_files(id, false, move |fs, writable| fs.content(path, writable))
            .await
    }
    async fn save(
        &self,
        id: &str,
        path: String,
        request: WriteContent,
    ) -> Result<SavedFile, FileError> {
        self.with_files(id, true, move |fs, _| fs.save(path, request))
            .await
    }
    async fn download(&self, id: &str, path: String) -> Result<Download, FileError> {
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
        self.with_files(id, true, move |fs, _| fs.upload(path, overwrite, source))
            .await
    }
    async fn mkdir(&self, id: &str, path: String) -> Result<FileEntry, FileError> {
        self.with_files(id, true, move |fs, _| fs.mkdir(path)).await
    }
    async fn transfer(
        &self,
        id: &str,
        request: Transfer,
        copy: bool,
    ) -> Result<FileEntry, FileError> {
        self.with_files(id, true, move |fs, _| fs.transfer(request, copy))
            .await
    }
    async fn delete(&self, id: &str, path: String, recursive: bool) -> Result<(), FileError> {
        self.with_files(id, true, move |fs, _| fs.delete(path, recursive))
            .await
    }
}
