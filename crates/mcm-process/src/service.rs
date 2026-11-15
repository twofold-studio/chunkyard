use crate::validation;
use async_trait::async_trait;
use futures_util::{StreamExt, TryStreamExt, stream};
use mcm_core::server::*;
use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};
use tokio::sync::Mutex as AsyncMutex;
use uuid::Uuid;

pub struct ServerManager {
    pub(crate) root: PathBuf,
    default_image: String,
    pub(crate) repo: Arc<dyn ServerRepo>,
    pub(crate) runtime: Arc<dyn ServerRuntime>,
    locks: Mutex<HashMap<String, Arc<AsyncMutex<()>>>>,
    pub(crate) create_lock: AsyncMutex<()>,
    port_locks: Mutex<HashMap<u16, Arc<AsyncMutex<()>>>>,
    pub(crate) installers: Option<Arc<dyn mcm_core::software::SoftwareService>>,
    pub(crate) install_tasks: tokio_util::task::TaskTracker,
    pub(crate) properties_repo: Option<Arc<dyn mcm_core::properties::PropertiesRepo>>,
}
impl ServerManager {
    pub fn new(
        root: PathBuf,
        default_image: String,
        repo: Arc<dyn ServerRepo>,
        runtime: Arc<dyn ServerRuntime>,
    ) -> Self {
        Self {
            root,
            default_image,
            repo,
            runtime,
            locks: Mutex::new(HashMap::new()),
            create_lock: AsyncMutex::new(()),
            port_locks: Mutex::new(HashMap::new()),
            installers: None,
            install_tasks: tokio_util::task::TaskTracker::new(),
            properties_repo: None,
        }
    }
    pub fn with_installers(
        mut self,
        installers: Arc<dyn mcm_core::software::SoftwareService>,
    ) -> Self {
        self.installers = Some(installers);
        self
    }
    pub fn with_properties(mut self, repo: Arc<dyn mcm_core::properties::PropertiesRepo>) -> Self {
        self.properties_repo = Some(repo);
        self
    }
    pub(crate) async fn record(&self, id: &str) -> Result<Server, ServerError> {
        let id = Uuid::parse_str(id)
            .map_err(|_| ServerError::NotFound)?
            .to_string();
        self.repo.get(&id).await?.ok_or(ServerError::NotFound)
    }
    pub(crate) async fn local_record(&self, id: &str) -> Result<Server, ServerError> {
        let server = self.record(id).await?;
        if tokio::fs::symlink_metadata(crate::transitions::journal_path(&self.root, &server.id))
            .await
            .is_ok()
        {
            return Err(ServerError::Busy);
        }
        if server.archive.is_some() {
            return Err(ServerError::Archived);
        }
        Ok(server)
    }
    pub(crate) fn lock(&self, id: &str) -> Result<Arc<AsyncMutex<()>>, ServerError> {
        let mut locks = self.locks.lock().map_err(|_| ServerError::Busy)?;
        Ok(locks.entry(id.into()).or_default().clone())
    }
    pub(crate) async fn view(&self, server: Server) -> Result<ServerView, ServerError> {
        let status = match if server.archive.is_some() {
            Ok(RuntimeStatus::stopped())
        } else {
            self.runtime.status(&server).await
        } {
            Ok(status) => status,
            Err(ServerError::DockerUnavailable) => RuntimeStatus::unknown(),
            Err(error) => return Err(error),
        };
        Ok(ServerView {
            icon: self.display_icon(&server).await,
            directory: self.root.join(&server.id),
            server,
            status,
        })
    }
    async fn start_inner(
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
                if profile.mode == mcm_core::software::LaunchMode::Jar {
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
#[async_trait]
impl ServerService for ServerManager {
    async fn icon(&self, id: &str) -> Result<Vec<u8>, ServerError> {
        self.icon_content(id).await
    }
    async fn set_icon(&self, id: &str, bytes: Vec<u8>) -> Result<ServerView, ServerError> {
        self.upload_icon(id, bytes).await
    }
    async fn reset_icon(&self, id: &str) -> Result<ServerView, ServerError> {
        self.remove_icon(id).await
    }
    async fn launch_settings(&self, id: &str) -> Result<LaunchSettings, ServerError> {
        self.read_launch(id).await
    }
    async fn set_launch(&self, id: &str, request: LaunchUpdate) -> Result<ServerView, ServerError> {
        self.update_launch(id, request).await
    }
    async fn shutdown(&self) {
        self.install_tasks.close();
        self.install_tasks.wait().await;
        self.runtime.shutdown().await;
    }
    async fn install_with_options(
        &self,
        id: &str,
        options: mcm_core::software::InstallOptions,
    ) -> Result<ServerView, ServerError> {
        self.install_with_progress(id, options, Default::default())
            .await
    }
    async fn install_with_progress(
        &self,
        id: &str,
        options: mcm_core::software::InstallOptions,
        progress: mcm_core::progress::ProgressReporter,
    ) -> Result<ServerView, ServerError> {
        if matches!(
            self.local_record(id).await?.software,
            Some(mcm_core::software::Software::CurseForge { .. })
        ) {
            self.install_pack(id, options, progress).await
        } else {
            self.install_managed(id, progress).await
        }
    }
    async fn set_resources(
        &self,
        id: &str,
        request: ResourceUpdate,
    ) -> Result<ServerView, ServerError> {
        validation::resources(request.memory_min_mb, request.memory_max_mb, request.cpus)?;
        let server = self.local_record(id).await?;
        let lock = self.lock(&server.id)?;
        let _guard = lock.try_lock().map_err(|_| ServerError::Busy)?;
        let mut server = self.local_record(id).await?;
        if self.runtime.status(&server).await?.state != ServerState::Stopped {
            return Err(ServerError::AlreadyRunning);
        }
        self.runtime.remove(&server).await?;
        self.repo.set_resources(&server.id, &request).await?;
        server.memory_min_mb = request.memory_min_mb;
        server.memory_max_mb = request.memory_max_mb;
        server.cpus = request.cpus;
        self.view(server).await
    }
    async fn console_stream(&self, id: &str) -> Result<ConsoleStream, ServerError> {
        let server = self.local_record(id).await?;
        if self.runtime.status(&server).await?.state != ServerState::Running {
            return Err(ServerError::NotRunning);
        }
        self.runtime.stream_logs(&server, 200).await
    }
    async fn network(&self, id: &str) -> Result<NetworkSettings, ServerError> {
        self.runtime.network(&self.local_record(id).await?).await
    }
    async fn set_network(
        &self,
        id: &str,
        request: NetworkUpdate,
    ) -> Result<ServerView, ServerError> {
        if request.port == 0 {
            return Err(ServerError::Invalid("port must be between 1 and 65535"));
        }
        let server = self.local_record(id).await?;
        let lock = self.lock(&server.id)?;
        let _guard = lock.try_lock().map_err(|_| ServerError::Busy)?;
        let mut server = self.local_record(id).await?;
        if self.runtime.status(&server).await?.state != ServerState::Stopped {
            return Err(ServerError::AlreadyRunning);
        }
        self.runtime.remove(&server).await?;
        self.repo
            .set_network(&server.id, request.port, request.publish_ip)
            .await?;
        server.port = request.port;
        server.publish_ip = request.publish_ip;
        self.view(server).await
    }
    async fn delete(&self, id: &str, delete_files: bool) -> Result<DeletedServer, ServerError> {
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

    async fn install(&self, id: &str) -> Result<ServerView, ServerError> {
        self.install_with_progress(id, Default::default(), Default::default())
            .await
    }
    async fn create(&self, request: CreateServer) -> Result<ServerView, ServerError> {
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
    async fn list(&self) -> Result<Vec<ServerView>, ServerError> {
        stream::iter(self.repo.list().await?)
            .map(|s| self.view(s))
            .buffered(4)
            .try_collect()
            .await
    }
    async fn get(&self, id: &str) -> Result<ServerView, ServerError> {
        self.view(self.record(id).await?).await
    }
    async fn metrics(&self, id: &str) -> Result<ServerMetrics, ServerError> {
        self.runtime.metrics(&self.local_record(id).await?).await
    }
    async fn metrics_stream(&self, id: &str) -> Result<MetricsStream, ServerError> {
        self.runtime
            .stream_metrics(&self.local_record(id).await?)
            .await
    }
    async fn metrics_stream_at(
        &self,
        id: &str,
        sampling: MetricsSampling,
    ) -> Result<MetricsStream, ServerError> {
        self.runtime
            .stream_metrics_at(&self.local_record(id).await?, sampling)
            .await
    }
    async fn set_eula(&self, id: &str, accepted: bool) -> Result<ServerView, ServerError> {
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
    async fn start(&self, id: &str) -> Result<ServerView, ServerError> {
        let server = self.local_record(id).await?;
        let lock = self.lock(&server.id)?;
        let guard = Arc::new(lock.try_lock_owned().map_err(|_| ServerError::Busy)?);
        let server = self.local_record(id).await?;
        let status = self.start_inner(&server, guard).await?;
        Ok(ServerView {
            icon: self.display_icon(&server).await,
            directory: self.root.join(&server.id),
            server,
            status,
        })
    }
    async fn stop(&self, id: &str) -> Result<ServerView, ServerError> {
        let server = self.local_record(id).await?;
        let lock = self.lock(&server.id)?;
        let _guard = lock.try_lock().map_err(|_| ServerError::Busy)?;
        let server = self.local_record(id).await?;
        let status = self.runtime.stop(&server).await?;
        Ok(ServerView {
            icon: self.display_icon(&server).await,
            directory: self.root.join(&server.id),
            server,
            status,
        })
    }
    async fn restart(&self, id: &str) -> Result<ServerView, ServerError> {
        let server = self.local_record(id).await?;
        let lock = self.lock(&server.id)?;
        let guard = Arc::new(lock.try_lock_owned().map_err(|_| ServerError::Busy)?);
        let server = self.local_record(id).await?;
        self.runtime.stop(&server).await?;
        let status = self.start_inner(&server, guard).await?;
        Ok(ServerView {
            icon: self.display_icon(&server).await,
            directory: self.root.join(&server.id),
            server,
            status,
        })
    }
    async fn kill(&self, id: &str) -> Result<ServerView, ServerError> {
        let server = self.local_record(id).await?;
        let lock = self.lock(&server.id)?;
        let _guard = lock.try_lock().map_err(|_| ServerError::Busy)?;
        let server = self.local_record(id).await?;
        let status = self.runtime.kill(&server).await?;
        Ok(ServerView {
            icon: self.display_icon(&server).await,
            directory: self.root.join(&server.id),
            server,
            status,
        })
    }
    async fn logs(&self, id: &str, tail: u32) -> Result<Vec<ConsoleLine>, ServerError> {
        if !(1..=1000).contains(&tail) {
            return Err(ServerError::Invalid("tail must be between 1 and 1000"));
        }
        self.runtime.logs(&self.local_record(id).await?, tail).await
    }
    async fn command(&self, id: &str, line: &str) -> Result<(), ServerError> {
        if line.is_empty() || line.len() > 4096 || line.contains(['\r', '\n', '\0']) {
            return Err(ServerError::Invalid(
                "command must be a single line of 1–4096 bytes",
            ));
        }
        self.runtime
            .command(&self.local_record(id).await?, line)
            .await
    }
    async fn runtime_info(&self) -> DockerInfo {
        self.runtime.info().await
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
fn fs_error(error: std::io::Error) -> ServerError {
    tracing::error!(%error, "server filesystem operation failed");
    ServerError::Filesystem
}
fn configuration_error(error: mcm_core::properties::PropertiesError) -> ServerError {
    tracing::error!(%error, "saved properties could not be applied or recorded");
    ServerError::Filesystem
}

impl ServerManager {
    async fn install_managed(
        &self,
        id: &str,
        progress: mcm_core::progress::ProgressReporter,
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
        progress.stage(mcm_core::progress::Stage::Finalize);
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
