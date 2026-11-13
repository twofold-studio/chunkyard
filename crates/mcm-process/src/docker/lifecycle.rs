use super::{DockerRuntime, docker_error};
use async_trait::async_trait;
use bollard::query_parameters::{
    CreateContainerOptionsBuilder, RemoveContainerOptionsBuilder, StopContainerOptionsBuilder,
};
use futures_util::StreamExt;
use mcm_core::server::*;
use std::{path::PathBuf, time::Duration};
#[async_trait]
impl ServerRuntime for DockerRuntime {
    async fn network(&self, server: &Server) -> Result<NetworkSettings, ServerError> {
        Ok(self.network_of(server, self.inspect(server).await?))
    }
    async fn remove(&self, server: &Server) -> Result<(), ServerError> {
        let Some(container) = self.inspect(server).await? else {
            return Ok(());
        };
        if container
            .state
            .as_ref()
            .is_some_and(|s| s.running == Some(true) || s.paused == Some(true))
        {
            return Err(ServerError::AlreadyRunning);
        }
        let id = container.id.ok_or(ServerError::Docker)?;
        let result = tokio::time::timeout(
            Duration::from_secs(15),
            self.client()?.remove_container(
                &id,
                Some(
                    RemoveContainerOptionsBuilder::default()
                        .force(false)
                        .v(false)
                        .build(),
                ),
            ),
        )
        .await
        .map_err(|_| ServerError::DockerUnavailable)?;
        match result {
            Ok(()) => Ok(()),
            Err(bollard::errors::Error::DockerResponseServerError {
                status_code: 404, ..
            }) => Ok(()),
            Err(bollard::errors::Error::DockerResponseServerError {
                status_code: 409, ..
            }) => Err(ServerError::AlreadyRunning),
            Err(error) => Err(docker_error(error)),
        }
    }
    async fn info(&self) -> DockerInfo {
        self.capability().await
    }
    async fn metrics(&self, server: &Server) -> Result<ServerMetrics, ServerError> {
        self.sample_metrics(server).await
    }
    async fn status(&self, server: &Server) -> Result<RuntimeStatus, ServerError> {
        Ok(Self::status_of(self.inspect(server).await?))
    }
    async fn start(
        &self,
        server: &Server,
        directory: PathBuf,
    ) -> Result<RuntimeStatus, ServerError> {
        let client = self.client()?;
        let mut existing = self.inspect(server).await?;
        if let Some(container) = &existing
            && container
                .state
                .as_ref()
                .is_some_and(|s| s.running == Some(true) || s.paused == Some(true))
        {
            return Err(ServerError::AlreadyRunning);
        }
        if existing.is_some() && self.network_of(server, existing.clone()).restart_required {
            self.remove(server).await?;
            existing = None;
        }
        if existing.is_none() {
            if !self.capability().await.available {
                return Err(ServerError::DockerUnavailable);
            }
            let image = tokio::time::timeout(
                Duration::from_secs(600),
                self.ensure_image(&server.docker_image),
            )
            .await
            .map_err(|_| ServerError::Docker)??;
            let body = self.body(server, directory, image, self.container_user().await?)?;
            client
                .create_container(
                    Some(
                        CreateContainerOptionsBuilder::default()
                            .name(&self.name(server))
                            .build(),
                    ),
                    body,
                )
                .await
                .map_err(docker_error)?;
        }
        client
            .start_container(&self.name(server), None)
            .await
            .map_err(|error| {
                if let bollard::errors::Error::DockerResponseServerError { message, .. } = &error {
                    let message = message.to_ascii_lowercase();
                    if message.contains("port is already allocated")
                        || message.contains("address already in use")
                    {
                        return ServerError::PortInUse;
                    }
                }
                docker_error(error)
            })?;
        self.status(server).await
    }
    async fn stop(&self, server: &Server) -> Result<RuntimeStatus, ServerError> {
        let status = self.status(server).await?;
        if status.state == ServerState::Stopped {
            return Ok(status);
        }
        if status.state == ServerState::Paused {
            return Err(ServerError::Invalid(
                "unpause the container before stopping it",
            ));
        }
        let client = self.client()?;
        // Minecraft's own command saves the world before shutdown.
        let sent = self.command(server, "stop").await.is_ok();
        if sent {
            let mut wait = client.wait_container(&self.name(server), None);
            if tokio::time::timeout(
                Duration::from_secs(self.config.stop_timeout_s.into()),
                wait.next(),
            )
            .await
            .is_ok()
            {
                let status = self.status(server).await?;
                if status.state == ServerState::Stopped {
                    return Ok(status);
                }
            }
        }
        client
            .stop_container(
                &self.name(server),
                Some(StopContainerOptionsBuilder::default().t(10).build()),
            )
            .await
            .map_err(docker_error)?;
        self.status(server).await
    }
    async fn kill(&self, server: &Server) -> Result<RuntimeStatus, ServerError> {
        let status = self.status(server).await?;
        if status.state == ServerState::Stopped {
            return Ok(status);
        }
        self.client()?
            .kill_container(&self.name(server), None)
            .await
            .map_err(docker_error)?;
        let client = self.client()?;
        let name = self.name(server);
        let mut wait = client.wait_container(&name, None);
        let _ = tokio::time::timeout(Duration::from_secs(10), wait.next()).await;
        self.status(server).await
    }
    async fn logs(&self, server: &Server, tail: u32) -> Result<Vec<ConsoleLine>, ServerError> {
        self.read_logs(server, tail).await
    }
    async fn command(&self, server: &Server, line: &str) -> Result<(), ServerError> {
        self.write_command(server, line).await
    }
}
