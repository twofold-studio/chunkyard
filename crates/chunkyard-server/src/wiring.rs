use chunkyard_api::AppState;
use chunkyard_auth::{AuthService, SetupToken};
use chunkyard_config::Config;
use chunkyard_core::auth::AuthRepo;
use chunkyard_db::{Database, SqliteAuthRepo, SqliteJobRepo, SqliteServerRepo};
use chunkyard_jobs::JobManager;
use std::{fs::File, sync::Arc};

#[derive(Debug, thiserror::Error)]
pub enum WiringError {
    #[error(transparent)]
    Config(#[from] chunkyard_config::ConfigError),
    #[error(transparent)]
    Database(#[from] chunkyard_db::DatabaseError),
    #[error(transparent)]
    Auth(#[from] chunkyard_auth::AuthError),
    #[error(transparent)]
    Job(#[from] chunkyard_core::jobs::JobError),
    #[error(transparent)]
    Download(#[from] chunkyard_download::DownloadError),
    #[error(transparent)]
    Storage(#[from] chunkyard_core::repository::RepositoryError),
    #[error(transparent)]
    Io(#[from] std::io::Error),
}
pub struct Backend {
    pub state: AppState,
    pub database: Database,
    pub jobs: Arc<JobManager>,
    operations: Arc<chunkyard_process::Operations>,
    _lock: File,
}
/// External services shared by HTTP handlers, background operations and shutdown.
pub struct BackendDependencies {
    pub runtime: Arc<dyn chunkyard_core::server::ServerRuntime>,
    pub software: Arc<dyn chunkyard_core::software::SoftwareService>,
}
impl Backend {
    pub async fn shutdown(&self) {
        self.operations.shutdown().await;
        self.jobs.shutdown().await;
        self.state.servers.shutdown().await;
        self.database.close().await;
    }
    pub fn start_background(&self) {
        self.operations.start(self.jobs.clone());
    }
}
pub async fn build_state(config: &Config) -> Result<Backend, WiringError> {
    assemble(config, None).await
}

/// Assemble the complete backend once, using the supplied external services.
pub async fn build_state_with_dependencies(
    config: &Config,
    dependencies: BackendDependencies,
) -> Result<Backend, WiringError> {
    assemble(config, Some(dependencies)).await
}

async fn assemble(
    config: &Config,
    dependencies: Option<BackendDependencies>,
) -> Result<Backend, WiringError> {
    config.validate()?;
    let lock = crate::storage::prepare(&config.data_dir)?;
    let database = Database::open(&config.data_dir.join("mcm.db")).await?;
    let repo = Arc::new(SqliteAuthRepo::new(&database));
    let setup = if config.auth.enabled && repo.setup_required().await? {
        let setup = SetupToken::load_or_create(&config.data_dir.join("setup-token"))?;
        tracing::info!("Initial setup is required; read the token from <data-dir>/setup-token.");
        Some(setup)
    } else {
        None
    };
    let auth = Arc::new(AuthService::new(repo, setup).await?);
    let jobs = Arc::new(JobManager::new(Arc::new(SqliteJobRepo::new(&database)), 4).await?);
    let BackendDependencies { runtime, software } = match dependencies {
        Some(dependencies) => dependencies,
        None => production_dependencies(config).await?,
    };
    let operations_repo = Arc::new(chunkyard_db::SqliteOperationsRepo::new(&database));
    let servers = Arc::new(
        chunkyard_process::ServerManager::new(
            config.data_dir.join("servers"),
            config.docker.runtime_image.clone(),
            Arc::new(SqliteServerRepo::new(&database)),
            runtime,
        )
        .with_installers(software.clone())
        .with_properties(Arc::new(chunkyard_db::SqlitePropertiesRepo::new(&database)))
        .with_operations(operations_repo.clone()),
    );
    servers.recover_transitions().await.map_err(|_| {
        std::io::Error::other(
            "Instance transition recovery failed; original files and journals were retained.",
        )
    })?;
    let exports = Arc::new(chunkyard_process::ExportManager::new(
        config.data_dir.join("exports"),
        servers.clone(),
    )?);
    let connect_host = config.docker.connect_host.clone().unwrap_or_else(|| {
        url::Url::parse(&config.origin().unwrap_or_default())
            .ok()
            .and_then(|u| u.host_str().map(str::to_owned))
            .unwrap_or_default()
    });
    let operations = Arc::new(chunkyard_process::Operations::new(
        operations_repo,
        servers.clone(),
        servers.clone(),
        servers.clone(),
        exports.clone(),
        connect_host,
    )?);
    let state = AppState {
        operations: operations.clone(),
        metrics: Arc::new(chunkyard_api::MetricsHub::new()),
        exports,
        software,
        files: servers.clone(),
        properties: servers.clone(),
        servers,
        health: Arc::new(database.clone()),
        auth_enabled: config.auth.enabled,
        show_version: config.http.show_version,
        auth,
        jobs: jobs.clone(),
        origin: config.origin()?,
        secure_cookie: config.secure_cookie(),
    };
    Ok(Backend {
        state,
        database,
        jobs,
        operations,
        _lock: lock,
    })
}

async fn production_dependencies(config: &Config) -> Result<BackendDependencies, WiringError> {
    let software = Arc::new(
        chunkyard_install::Installers::new()?.with_curseforge(config.curseforge.api_key.clone()),
    );
    let runtime = Arc::new(chunkyard_process::DockerRuntime::new(
        config.docker.clone(),
        crate::storage::instance_id(&config.data_dir)?,
    ));
    if config.data_dir.join("servers").is_dir()
        && let Err(error) = runtime.recover_installers().await
        && !matches!(
            error,
            chunkyard_core::server::ServerError::DockerUnavailable
        )
    {
        tracing::warn!(%error, "could not recover interrupted loader installers");
    }
    Ok(BackendDependencies { runtime, software })
}
