use super::*;

impl ServerManager {
    pub(super) async fn stop_inner(&self, id: &str) -> Result<ServerView, ServerError> {
        let server = self.local_record(id).await?;
        let lock = self.lock(&server.id)?;
        let _guard = lock.try_lock().map_err(|_| ServerError::Busy)?;
        let server = self.local_record(id).await?;
        self.intent(id, false).await?;
        let status = self.runtime.stop(&server).await?;
        Ok(ServerView {
            icon: self.display_icon(&server).await,
            directory: self.root.join(&server.id),
            server,
            status,
        })
    }
    pub(super) async fn restart_inner(&self, id: &str) -> Result<ServerView, ServerError> {
        let server = self.local_record(id).await?;
        let lock = self.lock(&server.id)?;
        let guard = Arc::new(lock.try_lock_owned().map_err(|_| ServerError::Busy)?);
        let server = self.local_record(id).await?;
        self.runtime.stop(&server).await?;
        let status = self.start_inner(&server, guard.clone()).await?;
        self.intent(id, true).await?;
        Ok(ServerView {
            icon: self.display_icon(&server).await,
            directory: self.root.join(&server.id),
            server,
            status,
        })
    }
    pub(super) async fn kill_inner(&self, id: &str) -> Result<ServerView, ServerError> {
        let server = self.local_record(id).await?;
        let lock = self.lock(&server.id)?;
        let _guard = lock.try_lock().map_err(|_| ServerError::Busy)?;
        let server = self.local_record(id).await?;
        self.intent(id, false).await?;
        let status = self.runtime.kill(&server).await?;
        Ok(ServerView {
            icon: self.display_icon(&server).await,
            directory: self.root.join(&server.id),
            server,
            status,
        })
    }
}

impl ServerManager {
    pub(super) async fn intent(&self, id: &str, running: bool) -> Result<(), ServerError> {
        if let Some(repo) = &self.operations_repo {
            repo.patch(id,serde_json::json!({"desiredRunning":running,"intentAt":time::OffsetDateTime::now_utc().unix_timestamp_nanos() as i64,"restartAttempts":0,"nextRetryAt":null,"stableSince":null})).await?;
        }
        Ok(())
    }
    pub(super) async fn managed_start(
        &self,
        id: &str,
        manual: bool,
    ) -> Result<ServerView, ServerError> {
        let server = self.local_record(id).await?;
        let lock = self.lock(&server.id)?;
        let guard = Arc::new(lock.try_lock_owned().map_err(|_| ServerError::Busy)?);
        let server = self.local_record(id).await?;
        if !manual
            && let Some(repo) = &self.operations_repo
            && !repo.load(id).await?.desired_running
        {
            return Err(ServerError::Busy);
        }
        let status = self.start_inner(&server, guard.clone()).await?;
        if manual {
            self.intent(id, true).await?;
        }
        Ok(ServerView {
            icon: self.display_icon(&server).await,
            directory: self.root.join(&server.id),
            server,
            status,
        })
    }
    pub(super) async fn start_inner(
        &self,
        server: &Server,
        guard: crate::properties::InstanceGuard,
    ) -> Result<RuntimeStatus, ServerError> {
        if server.software.is_some() && server.launch.is_none() {
            return Err(ServerError::NotInstalled);
        }
        if !server.accept_eula {
            return Err(ServerError::EulaRequired);
        }
        let directory = tokio::fs::canonicalize(self.root.join(&server.id))
            .await
            .map_err(fs_error)?;
        let root = tokio::fs::canonicalize(&self.root)
            .await
            .map_err(fs_error)?;
        if !directory.starts_with(&root) {
            return Err(ServerError::MissingJar);
        }
        let profile = crate::launch::current(server);
        // Existing custom JAR records were validated by the legacy path policy.
        // Keep their benign interior dot/separator normalization compatible; new
        // explicit profiles and detected modpack profiles use the stricter policy.
        if server.launch_override.is_some()
            || server.launch.as_ref().is_some_and(|l| l.profile.is_some())
        {
            profile.validate()?;
        }
        let jar = tokio::fs::canonicalize(directory.join(&profile.path))
            .await
            .map_err(|_| {
                if profile.mode == chunkyard_core::software::LaunchMode::Jar {
                    ServerError::MissingJar
                } else {
                    ServerError::MissingLaunch
                }
            })?;
        if !jar.starts_with(&directory)
            || !tokio::fs::metadata(jar).await.map_err(fs_error)?.is_file()
        {
            return Err(ServerError::MissingJar);
        }
        let port_lock = {
            let mut ports = self.port_locks.lock().map_err(|_| ServerError::Busy)?;
            ports.entry(server.port).or_default().clone()
        };
        // Hold admission through Docker start, including image preparation. Two
        // concurrent starts on different instances sharing a port cannot both pass.
        let _port_guard = port_lock.lock().await;
        for other in self.repo.list().await? {
            if other.id == server.id || other.port != server.port {
                continue;
            }
            match self.runtime.status(&other).await?.state {
                ServerState::Running | ServerState::Paused => return Err(ServerError::PortInUse),
                ServerState::Unknown => return Err(ServerError::DockerUnavailable),
                ServerState::Stopped => (),
            }
        }
        if matches!(
            self.runtime.status(server).await?.state,
            ServerState::Running | ServerState::Paused
        ) {
            return Err(ServerError::AlreadyRunning);
        }
        let version = self
            .prepare_configuration(server, guard.clone())
            .await
            .map_err(configuration_error)?;
        let status = self.runtime.start(server, directory).await?;
        self.mark_configuration_applied(server, version)
            .await
            .map_err(configuration_error)?;
        Ok(status)
    }
}
