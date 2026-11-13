use async_trait::async_trait;
use mcm_core::server::*;
use std::{collections::HashMap, path::PathBuf, sync::Mutex};

#[derive(Default)]
pub struct FakeRuntime {
    states: Mutex<HashMap<String, ServerState>>,
    commands: Mutex<Vec<String>>,
}
impl FakeRuntime {
    fn set(&self, server: &Server, state: ServerState) -> Result<(), ServerError> {
        self.states
            .lock()
            .map_err(|_| ServerError::Busy)?
            .insert(server.id.clone(), state);
        Ok(())
    }
}
#[async_trait]
impl ServerRuntime for FakeRuntime {
    async fn info(&self) -> DockerInfo {
        DockerInfo {
            available: true,
            version: Some("fixture".into()),
            reason: None,
        }
    }
    async fn status(&self, server: &Server) -> Result<RuntimeStatus, ServerError> {
        let state = self
            .states
            .lock()
            .map_err(|_| ServerError::Busy)?
            .get(&server.id)
            .cloned()
            .unwrap_or(ServerState::Stopped);
        Ok(RuntimeStatus {
            state,
            container_id: Some(format!("fixture-{}", server.id)),
            exit_code: None,
            oom_killed: false,
        })
    }
    async fn start(&self, server: &Server, _: PathBuf) -> Result<RuntimeStatus, ServerError> {
        if self.status(server).await?.state == ServerState::Running {
            return Err(ServerError::AlreadyRunning);
        }
        self.set(server, ServerState::Running)?;
        self.status(server).await
    }
    async fn stop(&self, server: &Server) -> Result<RuntimeStatus, ServerError> {
        self.set(server, ServerState::Stopped)?;
        self.status(server).await
    }
    async fn kill(&self, server: &Server) -> Result<RuntimeStatus, ServerError> {
        self.stop(server).await
    }
    async fn logs(&self, _: &Server, _: u32) -> Result<Vec<ConsoleLine>, ServerError> {
        Ok(vec![ConsoleLine {
            stream: "stdout".into(),
            text: "Done (0.1s)!".into(),
        }])
    }
    async fn command(&self, server: &Server, line: &str) -> Result<(), ServerError> {
        if self.status(server).await?.state != ServerState::Running {
            return Err(ServerError::NotRunning);
        }
        self.commands
            .lock()
            .map_err(|_| ServerError::Busy)?
            .push(line.into());
        Ok(())
    }
}
