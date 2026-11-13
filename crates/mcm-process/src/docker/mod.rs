mod definition;
mod image;
mod io;
mod lifecycle;
use crate::DockerConfig;
use bollard::{Docker, errors::Error, models::ContainerInspectResponse};
use mcm_core::server::{DockerInfo, RuntimeStatus, Server, ServerError, ServerState};
use std::time::Duration;

pub struct DockerRuntime {
    client: Option<Docker>,
    config: DockerConfig,
    instance: String,
    negotiated: tokio::sync::OnceCell<()>,
}
impl DockerRuntime {
    pub fn new(config: DockerConfig, instance: String) -> Self {
        let client = if config.enabled {
            Docker::connect_with_defaults().ok()
        } else {
            None
        };
        Self {
            client,
            config,
            instance,
            negotiated: tokio::sync::OnceCell::new(),
        }
    }
    fn client(&self) -> Result<&Docker, ServerError> {
        self.client.as_ref().ok_or(ServerError::DockerUnavailable)
    }
    async fn ready(&self) -> Result<&Docker, ServerError> {
        let client = self.client()?;
        self.negotiated
            .get_or_try_init(|| async {
                tokio::time::timeout(Duration::from_secs(5), client.clone().negotiate_version())
                    .await
                    .map_err(|_| ServerError::DockerUnavailable)?
                    .map_err(|_| ServerError::DockerUnavailable)?;
                let version = client.client_version();
                if version.major_version < 1
                    || (version.major_version == 1 && version.minor_version < 41)
                {
                    return Err(ServerError::DockerUnavailable);
                }
                Ok(())
            })
            .await?;
        Ok(client)
    }
    fn name(&self, server: &Server) -> String {
        format!("mcm-{}-{}", self.instance, server.id)
    }
    async fn inspect(
        &self,
        server: &Server,
    ) -> Result<Option<ContainerInspectResponse>, ServerError> {
        let result = tokio::time::timeout(
            Duration::from_secs(10),
            self.ready()
                .await?
                .inspect_container(&self.name(server), None),
        )
        .await
        .map_err(|_| ServerError::DockerUnavailable)?;
        match result {
            Ok(container) => {
                let labels = container
                    .config
                    .as_ref()
                    .and_then(|c| c.labels.as_ref())
                    .ok_or(ServerError::ContainerConflict)?;
                if labels.get("mcm.instance_id") != Some(&self.instance)
                    || labels.get("mcm.server_id") != Some(&server.id)
                    || labels.get("mcm.managed").map(String::as_str) != Some("true")
                {
                    return Err(ServerError::ContainerConflict);
                }
                Ok(Some(container))
            }
            Err(Error::DockerResponseServerError {
                status_code: 404, ..
            }) => Ok(None),
            Err(_) => Err(ServerError::DockerUnavailable),
        }
    }
    fn status_of(container: Option<ContainerInspectResponse>) -> RuntimeStatus {
        let Some(container) = container else {
            return RuntimeStatus::stopped();
        };
        let state = container.state.unwrap_or_default();
        let status = if state.paused == Some(true) {
            ServerState::Paused
        } else if state.running == Some(true) {
            ServerState::Running
        } else {
            ServerState::Stopped
        };
        RuntimeStatus {
            state: status,
            container_id: container.id,
            exit_code: state.exit_code,
            oom_killed: state.oom_killed.unwrap_or(false),
        }
    }
    async fn capability(&self) -> DockerInfo {
        let Ok(client) = self.ready().await else {
            return unavailable("Docker is disabled or its connection is not configured.");
        };
        match tokio::time::timeout(Duration::from_secs(5), async {
            Ok::<_, Error>((client.info().await?, client.version().await?))
        })
        .await
        {
            Ok(Ok((info, version))) if info.os_type.as_deref() == Some("linux") => DockerInfo {
                available: true,
                version: version.version,
                reason: None,
            },
            _ => unavailable("A reachable Linux Docker engine is required."),
        }
    }
}
fn unavailable(reason: &str) -> DockerInfo {
    DockerInfo {
        available: false,
        version: None,
        reason: Some(reason.into()),
    }
}
fn docker_error(error: Error) -> ServerError {
    // Docker error bodies can contain paths or registry credentials; don't return them.
    tracing::warn!(kind = ?std::mem::discriminant(&error), "Docker operation failed");
    ServerError::Docker
}
