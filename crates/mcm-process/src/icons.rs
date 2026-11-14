use crate::ServerManager;
use mcm_core::{server::*, software::Software};
use sha2::{Digest, Sha256};
use std::{io::Write, path::PathBuf};

impl ServerManager {
    pub(crate) fn icon_path(&self, id: &str) -> PathBuf {
        self.root.join(".chunkyard-icons").join(format!("{id}.png"))
    }

    async fn custom_icon(&self, id: &str) -> Result<Option<Vec<u8>>, ServerError> {
        let path = self.icon_path(id);
        match tokio::fs::symlink_metadata(&path).await {
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Ok(meta) if meta.is_file() && meta.len() <= 300_000 => {}
            _ => return Err(ServerError::IconStorage),
        }
        tokio::fs::read(path)
            .await
            .map(Some)
            .map_err(|_| ServerError::IconStorage)
    }

    pub(crate) async fn display_icon(&self, server: &Server) -> Option<DisplayIcon> {
        match self.custom_icon(&server.id).await {
            Ok(Some(bytes)) => {
                return Some(DisplayIcon {
                    url: format!(
                        "/api/v1/servers/{}/icon?v={:x}",
                        server.id,
                        Sha256::digest(&bytes)
                    ),
                    source: "custom",
                });
            }
            Err(_) => tracing::warn!("A server display icon could not be read"),
            Ok(None) => {}
        }
        match server.software {
            Some(Software::CurseForge { project_id, .. }) => Some(DisplayIcon {
                url: format!("/api/v1/servers/{}/icon?v=pack-{project_id}", server.id),
                source: "modpack",
            }),
            _ => None,
        }
    }

    pub(crate) async fn icon_content(&self, id: &str) -> Result<Vec<u8>, ServerError> {
        let server = self.record(id).await?;
        if let Some(bytes) = self.custom_icon(&server.id).await? {
            return Ok(bytes);
        }
        if let Some(Software::CurseForge { project_id, .. }) = server.software
            && let Some(installers) = &self.installers
        {
            return installers
                .modpack_logo(project_id)
                .await
                .map_err(ServerError::from);
        }
        Err(ServerError::IconNotFound)
    }

    pub(crate) async fn upload_icon(
        &self,
        id: &str,
        bytes: Vec<u8>,
    ) -> Result<ServerView, ServerError> {
        let server = self.record(id).await?;
        let guard = self
            .lock(&server.id)?
            .try_lock_owned()
            .map_err(|_| ServerError::Busy)?;
        self.record(&server.id).await?;
        let bytes = mcm_download::decode_icon(bytes)
            .await
            .map_err(|error| match error {
                mcm_download::IconDecodeError::TooLarge => ServerError::IconTooLarge,
                mcm_download::IconDecodeError::Unsupported => ServerError::IconUnsupported,
                mcm_download::IconDecodeError::Invalid => ServerError::IconInvalid,
            })?;
        let path = self.icon_path(&server.id);
        tokio::task::spawn_blocking(move || {
            // The owned guard survives caller cancellation until publication finishes.
            let _guard = guard;
            let directory = path.parent().ok_or(ServerError::IconStorage)?;
            std::fs::create_dir_all(directory).map_err(|_| ServerError::IconStorage)?;
            let mut file =
                tempfile::NamedTempFile::new_in(directory).map_err(|_| ServerError::IconStorage)?;
            file.write_all(&bytes)
                .map_err(|_| ServerError::IconStorage)?;
            file.as_file()
                .sync_all()
                .map_err(|_| ServerError::IconStorage)?;
            file.persist(path).map_err(|_| ServerError::IconStorage)?;
            Ok::<_, ServerError>(())
        })
        .await
        .map_err(|_| ServerError::IconStorage)??;
        self.view(server).await
    }

    pub(crate) async fn remove_icon(&self, id: &str) -> Result<ServerView, ServerError> {
        let server = self.record(id).await?;
        let lock = self.lock(&server.id)?;
        let _guard = lock.try_lock().map_err(|_| ServerError::Busy)?;
        self.record(&server.id).await?;
        match tokio::fs::remove_file(self.icon_path(&server.id)).await {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => return Err(ServerError::IconStorage),
        }
        self.view(server).await
    }
}
