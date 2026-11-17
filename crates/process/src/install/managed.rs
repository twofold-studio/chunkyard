use crate::{ServerManager, service::fs_error};
use chunkyard_core::server::*;

impl ServerManager {
    pub(crate) async fn install_managed(
        &self,
        id: &str,
        progress: chunkyard_core::progress::ProgressReporter,
    ) -> Result<ServerView, ServerError> {
        let server = self.local_record(id).await?;
        let lock = self.lock(&server.id)?;
        let _guard = lock.try_lock().map_err(|_| ServerError::Busy)?;
        let mut server = self.local_record(id).await?;
        if server.launch.is_some() {
            return Err(ServerError::AlreadyInstalled);
        }
        let software = server.software.as_ref().ok_or(ServerError::Invalid(
            "Custom servers use a manually supplied JAR.",
        ))?;
        let status = self.runtime.status(&server).await?;
        if status.state != ServerState::Stopped {
            return Err(ServerError::AlreadyRunning);
        }
        // An old game container would retain its original command/image across starts.
        if status.container_id.is_some() {
            return Err(ServerError::Invalid(
                "Install software before creating a game container.",
            ));
        }
        let directory = tokio::fs::canonicalize(self.root.join(&server.id))
            .await
            .map_err(fs_error)?;
        let root = tokio::fs::canonicalize(&self.root)
            .await
            .map_err(fs_error)?;
        if !directory.starts_with(root) {
            return Err(ServerError::Filesystem);
        }
        let staging = tempfile::Builder::new()
            .prefix(".chunkyard-software-")
            .tempdir_in(&directory)
            .map_err(fs_error)?;
        let installers = self.installers.as_ref().ok_or(ServerError::Invalid(
            "Server software installers are unavailable.",
        ))?;
        let mut launch = installers
            .prepare_with_progress(software, staging.path(), progress.clone())
            .await?;
        if !tokio::fs::metadata(staging.path().join("server.jar"))
            .await
            .map_err(fs_error)?
            .is_file()
        {
            return Err(ServerError::MissingJar);
        }
        // Keep the complete artifact before persisting its reference. Interrupted DB work
        // can leave an unused directory, but never a record pointing at a deleted staging file.
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            tokio::fs::set_permissions(
                staging.path().join("server.jar"),
                std::fs::Permissions::from_mode(0o644),
            )
            .await
            .map_err(fs_error)?;
            tokio::fs::set_permissions(staging.path(), std::fs::Permissions::from_mode(0o755))
                .await
                .map_err(fs_error)?;
        }
        progress.stage(chunkyard_core::progress::Stage::Finalize);
        let artifact = staging.keep();
        let relative = artifact
            .strip_prefix(&directory)
            .map_err(|_| ServerError::Filesystem)?
            .join("server.jar");
        launch.path = relative
            .to_str()
            .ok_or(ServerError::Filesystem)?
            .replace('\\', "/");
        if server.auto_java {
            server.docker_image = format!("eclipse-temurin:{}-jre", launch.java_major)
        }
        if let Err(error) = self
            .repo
            .set_installation(&server.id, &launch, &server.docker_image)
            .await
        {
            let _ = tokio::fs::remove_dir_all(artifact).await;
            return Err(error.into());
        }
        server.jar = launch.path.clone();
        server.launch = Some(launch);
        Ok(ServerView {
            icon: self.display_icon(&server).await,
            server,
            directory,
            status,
        })
    }
}
