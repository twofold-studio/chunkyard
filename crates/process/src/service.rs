mod archives;
mod instances;
mod lifecycle;
mod settings;
use crate::validation;
use async_trait::async_trait;
use chunkyard_core::server::*;
use futures_util::{StreamExt, TryStreamExt, stream};
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
    create_lock: AsyncMutex<()>,
    port_locks: Mutex<HashMap<u16, Arc<AsyncMutex<()>>>>,
    pub(crate) installers: Option<Arc<dyn chunkyard_core::software::SoftwareService>>,
    pub(crate) install_tasks: tokio_util::task::TaskTracker,
    pub(crate) properties_repo: Option<Arc<dyn chunkyard_core::properties::PropertiesRepo>>,
    operations_repo: Option<Arc<dyn chunkyard_core::operations::OperationsRepo>>,
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
            operations_repo: None,
        }
    }
    pub fn with_installers(
        mut self,
        installers: Arc<dyn chunkyard_core::software::SoftwareService>,
    ) -> Self {
        self.installers = Some(installers);
        self
    }
    pub fn with_properties(
        mut self,
        repo: Arc<dyn chunkyard_core::properties::PropertiesRepo>,
    ) -> Self {
        self.properties_repo = Some(repo);
        self
    }
    pub fn with_operations(
        mut self,
        repo: Arc<dyn chunkyard_core::operations::OperationsRepo>,
    ) -> Self {
        self.operations_repo = Some(repo);
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
}
#[async_trait]
impl ServerService for ServerManager {
    async fn records(&self) -> Result<Vec<Server>, ServerError> {
        Ok(self.repo.list().await?)
    }
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
        options: chunkyard_core::software::InstallOptions,
    ) -> Result<ServerView, ServerError> {
        self.install_with_progress(id, options, Default::default())
            .await
    }
    async fn install_with_progress(
        &self,
        id: &str,
        options: chunkyard_core::software::InstallOptions,
        progress: chunkyard_core::progress::ProgressReporter,
    ) -> Result<ServerView, ServerError> {
        if matches!(
            self.local_record(id).await?.software,
            Some(
                chunkyard_core::software::Software::CurseForge { .. }
                    | chunkyard_core::software::Software::Fabric { .. }
                    | chunkyard_core::software::Software::Forge { .. }
                    | chunkyard_core::software::Software::NeoForge { .. }
            )
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
        self.set_resources_inner(id, request).await
    }
    async fn console_stream(&self, id: &str) -> Result<ConsoleStream, ServerError> {
        let server = self.local_record(id).await?;
        if self.runtime.status(&server).await?.state != ServerState::Running {
            return Err(ServerError::NotRunning);
        }
        self.runtime.stream_logs(&server, 200).await
    }
    async fn network(&self, id: &str) -> Result<NetworkSettings, ServerError> {
        self.network_inner(id).await
    }
    async fn set_network(
        &self,
        id: &str,
        request: NetworkUpdate,
    ) -> Result<ServerView, ServerError> {
        self.set_network_inner(id, request).await
    }
    async fn delete(&self, id: &str, delete_files: bool) -> Result<DeletedServer, ServerError> {
        self.delete_inner(id, delete_files).await
    }

    async fn install(&self, id: &str) -> Result<ServerView, ServerError> {
        self.install_with_progress(id, Default::default(), Default::default())
            .await
    }
    async fn create(&self, request: CreateServer) -> Result<ServerView, ServerError> {
        self.create_inner(request).await
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
    async fn game_status(
        &self,
        id: &str,
    ) -> Result<chunkyard_core::operations::GameStatus, ServerError> {
        self.runtime
            .game_status(&self.local_record(id).await?)
            .await
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
        self.set_eula_inner(id, accepted).await
    }
    async fn start(&self, id: &str) -> Result<ServerView, ServerError> {
        self.managed_start(id, true).await
    }
    async fn automatic_start(&self, id: &str) -> Result<ServerView, ServerError> {
        self.managed_start(id, false).await
    }
    async fn stop(&self, id: &str) -> Result<ServerView, ServerError> {
        self.stop_inner(id).await
    }
    async fn restart(&self, id: &str) -> Result<ServerView, ServerError> {
        self.restart_inner(id).await
    }
    async fn kill(&self, id: &str) -> Result<ServerView, ServerError> {
        self.kill_inner(id).await
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
pub(crate) fn fs_error(error: std::io::Error) -> ServerError {
    tracing::error!(%error, "server filesystem operation failed");
    ServerError::Filesystem
}
fn configuration_error(error: chunkyard_core::properties::PropertiesError) -> ServerError {
    tracing::error!(%error, "saved properties could not be applied or recorded");
    ServerError::Filesystem
}
