use super::*;

impl ServerManager {
    pub(super) async fn delete_inner(
        &self,
        id: &str,
        delete_files: bool,
    ) -> Result<DeletedServer, ServerError> {
        let server = self.local_record(id).await?;
        let lock = self.lock(&server.id)?;
        let guard = Arc::new(lock.try_lock_owned().map_err(|_| ServerError::Busy)?);
        let server = self.local_record(id).await?;
        let status = self.runtime.status(&server).await?;
        if status.state != ServerState::Stopped {
            return Err(ServerError::AlreadyRunning);
        }
        let directory = self.root.join(&server.id);
        let retained = match tokio::fs::symlink_metadata(&directory).await {
            Ok(meta) => {
                if !meta.is_dir() || meta.file_type().is_symlink() {
                    return Err(ServerError::Filesystem);
                }
                let canonical = tokio::fs::canonicalize(&directory)
                    .await
                    .map_err(fs_error)?;
                let root = tokio::fs::canonicalize(&self.root)
                    .await
                    .map_err(fs_error)?;
                if canonical.parent() != Some(root.as_path()) {
                    return Err(ServerError::Filesystem);
                }
                Some(canonical)
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
            Err(error) => return Err(fs_error(error)),
        };
        // Runtime rechecks ownership/state and removes by immutable container ID.
        // Only after that succeeds may any world files or records be removed.
        self.runtime.remove(&server).await?;
        if !delete_files
            && retained.is_some()
            && let Some(repo) = &self.properties_repo
            && repo
                .state(&server.id)
                .await
                .map_err(configuration_error)?
                .desired
                .is_some()
        {
            // Retaining files must also retain the latest pending configuration,
            // even though its version history is removed with the instance record.
            self.prepare_configuration(&server, guard.clone())
                .await
                .map_err(configuration_error)?;
        }
        if delete_files && retained.is_some() {
            match tokio::fs::remove_dir_all(&directory).await {
                Ok(()) => (),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => (),
                Err(error) => return Err(fs_error(error)),
            }
        }
        self.repo.delete(&server.id).await?;
        if let Err(error) = tokio::fs::remove_file(self.icon_path(&server.id)).await
            && error.kind() != std::io::ErrorKind::NotFound
        {
            tracing::warn!("A deleted server's display icon could not be removed");
        }
        Ok(DeletedServer {
            id: server.id,
            files_deleted: delete_files,
            retained_directory: if delete_files { None } else { retained },
        })
    }
    pub(super) async fn create_inner(
        &self,
        request: CreateServer,
    ) -> Result<ServerView, ServerError> {
        validation::validate(&request)?;
        if let Some(software) = &request.software {
            software.validate()?;
        }
        let _guard = self.create_lock.lock().await;
        let existing = self.repo.list().await?;
        if existing.len() >= 100 {
            return Err(ServerError::Invalid("maximum of 100 servers reached"));
        }
        let assigned: HashSet<_> = existing.iter().map(|s| s.port).collect();
        let port = match request.port {
            Some(port) => port,
            None => (25565..=u16::MAX)
                .find(|port| !assigned.contains(port))
                .ok_or(ServerError::PortInUse)?,
        };
        let auto_java = request.software.is_some() && request.docker_image.is_none();
        let server = Server {
            archive: None,
            id: Uuid::new_v4().to_string(),
            name: request.name.trim().into(),
            runtime: "docker".into(),
            jar: request.jar,
            docker_image: request
                .docker_image
                .unwrap_or_else(|| self.default_image.clone()),
            port,
            memory_min_mb: request.memory_min_mb,
            memory_max_mb: request.memory_max_mb,
            cpus: request.cpus,
            accept_eula: request.accept_eula,
            auto_java,
            software: request.software,
            launch: None,
            publish_ip: None,
            launch_override: None,
        };
        tokio::fs::create_dir_all(&self.root)
            .await
            .map_err(fs_error)?;
        let directory = self.root.join(&server.id);
        tokio::fs::create_dir(&directory).await.map_err(fs_error)?;
        if let Err(error) = initialize(&directory, server.accept_eula).await {
            let _ = tokio::fs::remove_dir_all(&directory).await;
            return Err(error);
        }
        if let Err(error) = self.repo.insert(&server).await {
            let _ = tokio::fs::remove_dir_all(&directory).await;
            return Err(error);
        }
        Ok(ServerView {
            icon: self.display_icon(&server).await,
            server,
            directory,
            status: RuntimeStatus::stopped(),
        })
    }
    pub(super) async fn set_eula_inner(
        &self,
        id: &str,
        accepted: bool,
    ) -> Result<ServerView, ServerError> {
        let server = self.local_record(id).await?;
        let lock = self.lock(&server.id)?;
        let _guard = lock.try_lock().map_err(|_| ServerError::Busy)?;
        let mut server = self.local_record(id).await?;
        let status = self.runtime.status(&server).await?;
        if status.state != ServerState::Stopped {
            return Err(ServerError::AlreadyRunning);
        }
        let directory = self.root.join(&server.id);
        // A server could have replaced eula.txt with a symlink. Rename a fresh file
        // instead of following that path into another host directory.
        let temporary = directory.join(format!(".eula-{}", Uuid::new_v4()));
        tokio::fs::write(&temporary, format!("eula={accepted}\n"))
            .await
            .map_err(fs_error)?;
        if let Err(error) = tokio::fs::rename(&temporary, directory.join("eula.txt")).await {
            let _ = tokio::fs::remove_file(&temporary).await;
            return Err(fs_error(error));
        }
        self.repo.set_eula(&server.id, accepted).await?;
        server.accept_eula = accepted;
        Ok(ServerView {
            icon: self.display_icon(&server).await,
            server,
            directory,
            status,
        })
    }
}

async fn initialize(directory: &Path, accept: bool) -> Result<(), ServerError> {
    tokio::fs::write(directory.join("eula.txt"), format!("eula={accept}\n"))
        .await
        .map_err(fs_error)?;
    tokio::fs::write(
        directory.join("server.properties"),
        "server-port=25565\nenable-rcon=false\n",
    )
    .await
    .map_err(fs_error)?;
    Ok(())
}
