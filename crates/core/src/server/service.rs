use super::*;
use async_trait::async_trait;
#[async_trait]
pub trait ServerService: Send + Sync {
    /// Configuration inventory without mandatory runtime probes.
    async fn records(&self) -> Result<Vec<Server>, ServerError> {
        Ok(self
            .list()
            .await?
            .into_iter()
            .map(|view| view.server)
            .collect())
    }
    /// Internal automation path preserves the persisted retry budget.
    async fn automatic_start(&self, id: &str) -> Result<ServerView, ServerError> {
        self.start(id).await
    }
    async fn game_status(&self, _id: &str) -> Result<crate::operations::GameStatus, ServerError> {
        Err(ServerError::Invalid(
            "Minecraft status probing is unavailable for this runtime",
        ))
    }
    async fn metrics_stream_at(
        &self,
        id: &str,
        _sampling: MetricsSampling,
    ) -> Result<MetricsStream, ServerError> {
        self.metrics_stream(id).await
    }
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
