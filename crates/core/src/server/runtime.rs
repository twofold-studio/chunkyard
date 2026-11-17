use super::*;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
/// Shared collection cadence, updated as live metrics viewers join and leave.
#[derive(Clone)]
pub struct MetricsSampling(std::sync::Arc<std::sync::atomic::AtomicU64>);
impl MetricsSampling {
    pub fn new(interval_ms: u64) -> Self {
        Self(std::sync::Arc::new(std::sync::atomic::AtomicU64::new(
            interval_ms.clamp(100, 60000),
        )))
    }
    pub fn interval_ms(&self) -> u64 {
        self.0.load(std::sync::atomic::Ordering::Relaxed)
    }
    pub fn set_interval_ms(&self, interval_ms: u64) {
        self.0.store(
            interval_ms.clamp(100, 60000),
            std::sync::atomic::Ordering::Relaxed,
        );
    }
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ServerState {
    Stopped,
    Running,
    Paused,
    Unknown,
}
#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeStatus {
    #[schema(required = true)]
    pub state: ServerState,
    #[schema(required = true)]
    pub container_id: Option<String>,
    #[schema(required = true)]
    pub exit_code: Option<i64>,
    #[schema(required = true)]
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
/// Point-in-time container measurements. Missing measurements are null, never
/// invented zeroes. CPU is percent of one logical core and may exceed 100.
#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ServerMetrics {
    #[schema(required = true)]
    pub server_id: String,
    #[schema(required = true)]
    pub status: RuntimeStatus,
    #[schema(required = true)]
    pub sampled_at: String,
    #[schema(required = true)]
    pub started_at: Option<String>,
    #[schema(required = true)]
    pub uptime_seconds: Option<u64>,
    #[schema(required = true)]
    pub cpu_percent: Option<f64>,
    #[schema(required = true)]
    pub memory_usage_bytes: Option<u64>,
    #[schema(required = true)]
    pub memory_working_set_bytes: Option<u64>,
    #[schema(required = true)]
    pub memory_limit_bytes: Option<u64>,
    #[schema(required = true)]
    pub network_rx_bytes: Option<u64>,
    #[schema(required = true)]
    pub network_tx_bytes: Option<u64>,
    #[schema(required = true)]
    pub block_read_bytes: Option<u64>,
    #[schema(required = true)]
    pub block_write_bytes: Option<u64>,
    #[schema(required = true)]
    pub pids: Option<u64>,
}
#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct DockerInfo {
    #[schema(required = true)]
    pub available: bool,
    #[schema(required = true)]
    pub version: Option<String>,
    #[schema(required = true)]
    pub reason: Option<String>,
    #[schema(required = true)]
    pub capacity: Option<HostCapacity>,
}
/// Docker engine totals, not free resources or the manager container's limits.
#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct HostCapacity {
    #[schema(required = true)]
    pub logical_cpus: Option<u64>,
    #[schema(required = true)]
    pub memory_total_bytes: Option<u64>,
    #[schema(required = true)]
    pub architecture: Option<String>,
    #[schema(required = true)]
    pub operating_system: Option<String>,
}
#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct ConsoleLine {
    pub stream: String,
    pub text: String,
}
pub type ConsoleStream = futures_util::stream::BoxStream<'static, Result<ConsoleLine, ServerError>>;
pub type MetricsStream =
    futures_util::stream::BoxStream<'static, Result<ServerMetrics, ServerError>>;
/// Runtime implementations never choose arbitrary host paths; the service supplies
/// the single managed directory belonging to the persisted server.
#[async_trait]
pub trait ServerRuntime: Send + Sync {
    async fn game_status(
        &self,
        _server: &Server,
    ) -> Result<crate::operations::GameStatus, ServerError> {
        Err(ServerError::Invalid(
            "Minecraft status probing is unavailable for this runtime",
        ))
    }
    async fn stream_metrics_at(
        &self,
        server: &Server,
        _sampling: MetricsSampling,
    ) -> Result<MetricsStream, ServerError> {
        self.stream_metrics(server).await
    }
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
