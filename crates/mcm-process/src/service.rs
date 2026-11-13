use crate::validation;
use async_trait::async_trait;
use futures_util::{StreamExt, TryStreamExt, stream};
use mcm_core::server::*;
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};
use tokio::sync::Mutex as AsyncMutex;
use uuid::Uuid;

pub struct ServerManager {
    root: PathBuf,
    default_image: String,
    repo: Arc<dyn ServerRepo>,
    runtime: Arc<dyn ServerRuntime>,
    locks: Mutex<HashMap<String, Arc<AsyncMutex<()>>>>,
    create_lock: AsyncMutex<()>,
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
        }
    }
    async fn record(&self, id: &str) -> Result<Server, ServerError> {
        let id = Uuid::parse_str(id)
            .map_err(|_| ServerError::NotFound)?
            .to_string();
        self.repo.get(&id).await?.ok_or(ServerError::NotFound)
    }
    fn lock(&self, id: &str) -> Result<Arc<AsyncMutex<()>>, ServerError> {
        let mut locks = self.locks.lock().map_err(|_| ServerError::Busy)?;
        Ok(locks.entry(id.into()).or_default().clone())
    }
    async fn view(&self, server: Server) -> Result<ServerView, ServerError> {
        let status = match self.runtime.status(&server).await {
            Ok(status) => status,
            Err(ServerError::DockerUnavailable) => RuntimeStatus::unknown(),
            Err(error) => return Err(error),
        };
        Ok(ServerView {
            directory: self.root.join(&server.id),
            server,
            status,
        })
    }
    async fn start_inner(&self, server: &Server) -> Result<RuntimeStatus, ServerError> {
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
        let jar = tokio::fs::canonicalize(directory.join(&server.jar))
            .await
            .map_err(|_| ServerError::MissingJar)?;
        if !jar.starts_with(&directory)
            || !tokio::fs::metadata(jar).await.map_err(fs_error)?.is_file()
        {
            return Err(ServerError::MissingJar);
        }
        self.runtime.start(server, directory).await
    }
}
#[async_trait]
impl ServerService for ServerManager {
    async fn create(&self, request: CreateServer) -> Result<ServerView, ServerError> {
        validation::validate(&request)?;
        let _guard = self.create_lock.lock().await;
        let existing = self.repo.list().await?;
        if existing.len() >= 100 {
            return Err(ServerError::Invalid("maximum of 100 servers reached"));
        }
        if existing.iter().any(|s| s.port == request.port) {
            return Err(ServerError::PortInUse);
        }
        let server = Server {
            id: Uuid::new_v4().to_string(),
            name: request.name.trim().into(),
            runtime: "docker".into(),
            jar: request.jar,
            docker_image: request
                .docker_image
                .unwrap_or_else(|| self.default_image.clone()),
            port: request.port,
            memory_min_mb: request.memory_min_mb,
            memory_max_mb: request.memory_max_mb,
            cpus: request.cpus,
            accept_eula: request.accept_eula,
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
    async fn set_eula(&self, id: &str, accepted: bool) -> Result<ServerView, ServerError> {
        let mut server = self.record(id).await?;
        let lock = self.lock(&server.id)?;
        let _guard = lock.try_lock().map_err(|_| ServerError::Busy)?;
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
            server,
            directory,
            status,
        })
    }
    async fn start(&self, id: &str) -> Result<ServerView, ServerError> {
        let server = self.record(id).await?;
        let lock = self.lock(&server.id)?;
        let _guard = lock.try_lock().map_err(|_| ServerError::Busy)?;
        let status = self.start_inner(&server).await?;
        Ok(ServerView {
            directory: self.root.join(&server.id),
            server,
            status,
        })
    }
    async fn stop(&self, id: &str) -> Result<ServerView, ServerError> {
        let server = self.record(id).await?;
        let lock = self.lock(&server.id)?;
        let _guard = lock.try_lock().map_err(|_| ServerError::Busy)?;
        let status = self.runtime.stop(&server).await?;
        Ok(ServerView {
            directory: self.root.join(&server.id),
            server,
            status,
        })
    }
    async fn restart(&self, id: &str) -> Result<ServerView, ServerError> {
        let server = self.record(id).await?;
        let lock = self.lock(&server.id)?;
        let _guard = lock.try_lock().map_err(|_| ServerError::Busy)?;
        self.runtime.stop(&server).await?;
        let status = self.start_inner(&server).await?;
        Ok(ServerView {
            directory: self.root.join(&server.id),
            server,
            status,
        })
    }
    async fn kill(&self, id: &str) -> Result<ServerView, ServerError> {
        let server = self.record(id).await?;
        let lock = self.lock(&server.id)?;
        let _guard = lock.try_lock().map_err(|_| ServerError::Busy)?;
        let status = self.runtime.kill(&server).await?;
        Ok(ServerView {
            directory: self.root.join(&server.id),
            server,
            status,
        })
    }
    async fn logs(&self, id: &str, tail: u32) -> Result<Vec<ConsoleLine>, ServerError> {
        if !(1..=1000).contains(&tail) {
            return Err(ServerError::Invalid("tail must be between 1 and 1000"));
        }
        self.runtime.logs(&self.record(id).await?, tail).await
    }
    async fn command(&self, id: &str, line: &str) -> Result<(), ServerError> {
        if line.is_empty() || line.len() > 4096 || line.contains(['\r', '\n', '\0']) {
            return Err(ServerError::Invalid(
                "command must be a single line of 1–4096 bytes",
            ));
        }
        self.runtime.command(&self.record(id).await?, line).await
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
