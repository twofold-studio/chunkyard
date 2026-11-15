//! Server records and runtime boundaries shared by transport, storage and supervision.
use crate::repository::RepositoryError;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::{net::IpAddr, path::PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Server {
    #[serde(default)]
    pub archive: Option<ArchiveReference>,
    pub id: String,
    pub name: String,
    pub runtime: String,
    pub jar: String,
    pub docker_image: String,
    pub port: u16,
    pub memory_min_mb: u32,
    pub memory_max_mb: u32,
    pub cpus: f64,
    pub accept_eula: bool,
    #[serde(default)]
    pub software: Option<crate::software::Software>,
    #[serde(default)]
    pub launch: Option<crate::software::Launch>,
    #[serde(default)]
    pub auto_java: bool,
    #[serde(default)]
    pub publish_ip: Option<IpAddr>,
    #[serde(default)]
    pub launch_override: Option<crate::software::LaunchProfile>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveReference {
    pub export_id: String,
    pub archived_at: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchSettings {
    pub detected: crate::software::LaunchProfile,
    pub current: crate::software::LaunchProfile,
    pub overridden: bool,
    pub docker_image: String,
    pub auto_java: bool,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LaunchUpdate {
    #[serde(deserialize_with = "deserialize_profile")]
    pub profile: Option<crate::software::LaunchProfile>,
    #[serde(default, deserialize_with = "deserialize_image")]
    pub docker_image: Option<Option<String>>,
}
fn deserialize_profile<'de, D: serde::Deserializer<'de>>(
    d: D,
) -> Result<Option<crate::software::LaunchProfile>, D::Error> {
    Option::<crate::software::LaunchProfile>::deserialize(d)
}
fn deserialize_image<'de, D: serde::Deserializer<'de>>(
    d: D,
) -> Result<Option<Option<String>>, D::Error> {
    Ok(Some(Option::<String>::deserialize(d)?))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkSettings {
    pub port: u16,
    pub publish_ip: Option<IpAddr>,
    pub effective_publish_ip: IpAddr,
    pub bound_publish_ip: Option<String>,
    pub bound_port: Option<u16>,
    pub restart_required: bool,
    pub status: RuntimeStatus,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NetworkUpdate {
    pub port: u16,
    pub publish_ip: Option<IpAddr>,
}
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResourceUpdate {
    pub memory_min_mb: u32,
    pub memory_max_mb: u32,
    pub cpus: f64,
}
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateServer {
    #[serde(default = "default_runtime")]
    pub runtime: String,
    pub name: String,
    /// Omit/null to allocate an unassigned managed host port.
    #[serde(default)]
    pub port: Option<u16>,
    #[serde(default = "default_jar")]
    pub jar: String,
    #[serde(default)]
    pub docker_image: Option<String>,
    #[serde(default = "default_min")]
    pub memory_min_mb: u32,
    #[serde(default = "default_max")]
    pub memory_max_mb: u32,
    #[serde(default = "default_cpus")]
    pub cpus: f64,
    #[serde(default)]
    pub accept_eula: bool,
    #[serde(default)]
    pub software: Option<crate::software::Software>,
}
fn default_runtime() -> String {
    "docker".into()
}
fn default_jar() -> String {
    "server.jar".into()
}
fn default_min() -> u32 {
    512
}
fn default_max() -> u32 {
    2048
}
fn default_cpus() -> f64 {
    2.0
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ServerState {
    Stopped,
    Running,
    Paused,
    Unknown,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeStatus {
    pub state: ServerState,
    pub container_id: Option<String>,
    pub exit_code: Option<i64>,
    pub oom_killed: bool,
}
impl RuntimeStatus {
    pub fn stopped() -> Self {
        Self {
            state: ServerState::Stopped,
            container_id: None,
            exit_code: None,
            oom_killed: false,
        }
    }
    pub fn unknown() -> Self {
        Self {
            state: ServerState::Unknown,
            ..Self::stopped()
        }
    }
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerView {
    #[serde(flatten)]
    pub server: Server,
    pub directory: PathBuf,
    pub status: RuntimeStatus,
    pub icon: Option<DisplayIcon>,
}
#[derive(Debug, Clone, Serialize)]
pub struct DisplayIcon {
    pub url: String,
    pub source: &'static str,
}
/// Completed deletion. Retained files are never implicitly adopted by a new instance.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeletedServer {
    pub id: String,
    pub files_deleted: bool,
    pub retained_directory: Option<PathBuf>,
}
/// Point-in-time container measurements. Missing measurements are null, never
/// invented zeroes. CPU is percent of one logical core and may exceed 100.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerMetrics {
    pub server_id: String,
    pub status: RuntimeStatus,
    pub sampled_at: String,
    pub started_at: Option<String>,
    pub uptime_seconds: Option<u64>,
    pub cpu_percent: Option<f64>,
    pub memory_usage_bytes: Option<u64>,
    pub memory_working_set_bytes: Option<u64>,
    pub memory_limit_bytes: Option<u64>,
    pub network_rx_bytes: Option<u64>,
    pub network_tx_bytes: Option<u64>,
    pub block_read_bytes: Option<u64>,
    pub block_write_bytes: Option<u64>,
    pub pids: Option<u64>,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DockerInfo {
    pub available: bool,
    pub version: Option<String>,
    pub reason: Option<String>,
    pub capacity: Option<HostCapacity>,
}
/// Docker engine totals, not free resources or the manager container's limits.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostCapacity {
    pub logical_cpus: Option<u64>,
    pub memory_total_bytes: Option<u64>,
    pub architecture: Option<String>,
    pub operating_system: Option<String>,
}
#[derive(Debug, Serialize)]
pub struct ConsoleLine {
    pub stream: String,
    pub text: String,
}
pub type ConsoleStream = futures_util::stream::BoxStream<'static, Result<ConsoleLine, ServerError>>;
pub type MetricsStream =
    futures_util::stream::BoxStream<'static, Result<ServerMetrics, ServerError>>;
#[derive(Debug, thiserror::Error)]
pub enum ServerError {
    #[error("Restore this archived instance before using its local files or runtime.")]
    Archived,
    #[error("The image is invalid or exceeds decoding limits.")]
    IconInvalid,
    #[error("Use a PNG, JPEG, WebP or ICO image.")]
    IconUnsupported,
    #[error("The icon exceeds 2 MiB.")]
    IconTooLarge,
    #[error("No icon is available.")]
    IconNotFound,
    #[error("The display icon could not be saved or loaded.")]
    IconStorage,
    #[error("The configured launch file is missing. Check the launch settings and Files.")]
    MissingLaunch,
    #[error("{0}")]
    Invalid(&'static str),
    #[error("server not found")]
    NotFound,
    #[error("server operation already in progress")]
    Busy,
    #[error("another server is already running on this game port")]
    PortInUse,
    #[error("server is already running")]
    AlreadyRunning,
    #[error("server is not running")]
    NotRunning,
    #[error("place the configured server JAR in the server directory before starting")]
    MissingJar,
    #[error("Install the selected software before starting the server.")]
    NotInstalled,
    #[error("Server software is already installed; reinstalling could overwrite server files.")]
    AlreadyInstalled,
    #[error(transparent)]
    Software(#[from] crate::software::SoftwareError),
    #[error("accept the Minecraft EULA before starting")]
    EulaRequired,
    #[error("Docker is unavailable or is not a Linux container engine")]
    DockerUnavailable,
    #[error("all metrics sampling slots are busy; retry shortly")]
    MetricsBusy,
    #[error("container identity does not match this manager and server")]
    ContainerConflict,
    #[error("Docker operation failed")]
    Docker,
    #[error("server filesystem operation failed")]
    Filesystem,
    #[error(transparent)]
    Storage(#[from] RepositoryError),
}
#[async_trait]
pub trait ServerRepo: Send + Sync {
    async fn save(&self, server: &Server) -> Result<(), RepositoryError>;
    async fn set_launch(
        &self,
        id: &str,
        profile: Option<&crate::software::LaunchProfile>,
        image: &str,
        auto_java: bool,
    ) -> Result<(), RepositoryError>;
    async fn set_resources(
        &self,
        id: &str,
        request: &ResourceUpdate,
    ) -> Result<(), RepositoryError>;
    async fn set_network(
        &self,
        id: &str,
        port: u16,
        publish_ip: Option<IpAddr>,
    ) -> Result<(), RepositoryError>;
    async fn delete(&self, id: &str) -> Result<(), RepositoryError>;
    async fn insert(&self, server: &Server) -> Result<(), ServerError>;
    async fn set_eula(&self, id: &str, accepted: bool) -> Result<(), RepositoryError>;
    async fn set_installation(
        &self,
        id: &str,
        launch: &crate::software::Launch,
        image: &str,
    ) -> Result<(), RepositoryError>;
    async fn get(&self, id: &str) -> Result<Option<Server>, RepositoryError>;
    async fn list(&self) -> Result<Vec<Server>, RepositoryError>;
}
/// Runtime implementations never choose arbitrary host paths; the service supplies
/// the single managed directory belonging to the persisted server.
#[async_trait]
pub trait ServerRuntime: Send + Sync {
    async fn stream_metrics(&self, server: &Server) -> Result<MetricsStream, ServerError> {
        Ok(Box::pin(futures_util::stream::iter([Ok(self
            .metrics(server)
            .await?)])))
    }
    async fn run_installer(
        &self,
        _server: &Server,
        _directory: PathBuf,
        _command: crate::software::InstallerCommand,
        _lease: std::sync::Arc<dyn Send + Sync>,
    ) -> Result<(), ServerError> {
        Err(ServerError::Software(
            crate::software::SoftwareError::InstallFailed,
        ))
    }
    async fn shutdown(&self) {}
    async fn stream_logs(&self, server: &Server, tail: u32) -> Result<ConsoleStream, ServerError> {
        use futures_util::StreamExt;
        let lines = self.logs(server, tail).await?;
        Ok(Box::pin(
            futures_util::stream::iter(lines.into_iter().map(Ok))
                .chain(futures_util::stream::pending()),
        ))
    }
    /// Distinguishes separate starts of a reused container. Unknown means an
    /// applied configuration revision must not be claimed as current.
    async fn configuration_identity(&self, server: &Server) -> Result<Option<String>, ServerError> {
        Ok(self.status(server).await?.container_id)
    }
    async fn network(&self, server: &Server) -> Result<NetworkSettings, ServerError> {
        Ok(NetworkSettings {
            port: server.port,
            publish_ip: server.publish_ip,
            effective_publish_ip: server.publish_ip.unwrap_or([0, 0, 0, 0].into()),
            bound_publish_ip: None,
            bound_port: None,
            restart_required: false,
            status: self.status(server).await?,
        })
    }
    /// Remove only this manager's stopped container; never force removal.
    async fn remove(&self, server: &Server) -> Result<(), ServerError>;
    async fn info(&self) -> DockerInfo;
    async fn metrics(&self, server: &Server) -> Result<ServerMetrics, ServerError>;
    async fn status(&self, server: &Server) -> Result<RuntimeStatus, ServerError>;
    async fn start(
        &self,
        server: &Server,
        directory: PathBuf,
    ) -> Result<RuntimeStatus, ServerError>;
    async fn stop(&self, server: &Server) -> Result<RuntimeStatus, ServerError>;
    async fn kill(&self, server: &Server) -> Result<RuntimeStatus, ServerError>;
    async fn logs(&self, server: &Server, tail: u32) -> Result<Vec<ConsoleLine>, ServerError>;
    async fn command(&self, server: &Server, line: &str) -> Result<(), ServerError>;
}
#[async_trait]
pub trait ServerService: Send + Sync {
    async fn metrics_stream(&self, id: &str) -> Result<MetricsStream, ServerError> {
        Ok(Box::pin(futures_util::stream::iter([Ok(self
            .metrics(id)
            .await?)])))
    }
    async fn install_with_progress(
        &self,
        id: &str,
        options: crate::software::InstallOptions,
        _progress: crate::progress::ProgressReporter,
    ) -> Result<ServerView, ServerError> {
        self.install_with_options(id, options).await
    }
    async fn icon(&self, id: &str) -> Result<Vec<u8>, ServerError>;
    async fn set_icon(&self, id: &str, bytes: Vec<u8>) -> Result<ServerView, ServerError>;
    async fn reset_icon(&self, id: &str) -> Result<ServerView, ServerError>;
    async fn launch_settings(&self, id: &str) -> Result<LaunchSettings, ServerError>;
    async fn set_launch(&self, id: &str, request: LaunchUpdate) -> Result<ServerView, ServerError>;
    async fn install_with_options(
        &self,
        id: &str,
        _options: crate::software::InstallOptions,
    ) -> Result<ServerView, ServerError> {
        self.install(id).await
    }
    async fn shutdown(&self) {}
    async fn set_resources(
        &self,
        id: &str,
        request: ResourceUpdate,
    ) -> Result<ServerView, ServerError>;
    async fn console_stream(&self, id: &str) -> Result<ConsoleStream, ServerError>;
    async fn network(&self, id: &str) -> Result<NetworkSettings, ServerError>;
    async fn set_network(
        &self,
        id: &str,
        request: NetworkUpdate,
    ) -> Result<ServerView, ServerError>;
    async fn delete(&self, id: &str, delete_files: bool) -> Result<DeletedServer, ServerError>;
    async fn install(&self, id: &str) -> Result<ServerView, ServerError>;
    async fn create(&self, request: CreateServer) -> Result<ServerView, ServerError>;
    async fn list(&self) -> Result<Vec<ServerView>, ServerError>;
    async fn get(&self, id: &str) -> Result<ServerView, ServerError>;
    async fn set_eula(&self, id: &str, accepted: bool) -> Result<ServerView, ServerError>;
    async fn metrics(&self, id: &str) -> Result<ServerMetrics, ServerError>;
    async fn start(&self, id: &str) -> Result<ServerView, ServerError>;
    async fn stop(&self, id: &str) -> Result<ServerView, ServerError>;
    async fn restart(&self, id: &str) -> Result<ServerView, ServerError>;
    async fn kill(&self, id: &str) -> Result<ServerView, ServerError>;
    async fn logs(&self, id: &str, tail: u32) -> Result<Vec<ConsoleLine>, ServerError>;
    async fn command(&self, id: &str, line: &str) -> Result<(), ServerError>;
    async fn runtime_info(&self) -> DockerInfo;
}

impl ServerError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::Archived => "server.archived",
            Self::IconInvalid => "icons.invalid",
            Self::IconUnsupported => "icons.unsupported",
            Self::IconTooLarge => "icons.too_large",
            Self::IconNotFound => "icons.not_found",
            Self::IconStorage => "icons.storage",
            Self::MissingLaunch => "server.launch_missing",
            Self::Invalid(_) => "validation",
            Self::NotFound => "server.not_found",
            Self::Busy => "server.busy",
            Self::PortInUse => "server.port_in_use",
            Self::AlreadyRunning => "server.running",
            Self::NotRunning => "server.not_running",
            Self::Software(error) => error.code(),
            Self::NotInstalled => "server.not_installed",
            Self::AlreadyInstalled => "server.already_installed",
            Self::MissingJar => "server.jar_missing",
            Self::EulaRequired => "server.eula_required",
            Self::DockerUnavailable => "docker.unavailable",
            Self::MetricsBusy => "metrics.busy",
            Self::ContainerConflict => "docker.identity_mismatch",
            Self::Docker => "docker.failed",
            Self::Filesystem | Self::Storage(_) => "internal",
        }
    }
    pub fn public_detail(&self) -> String {
        match self {
            Self::Storage(_) => "The server record could not be saved or loaded.".into(),
            _ => self.to_string(),
        }
    }
}
