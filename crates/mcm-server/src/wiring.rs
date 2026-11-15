use mcm_api::AppState;
use mcm_auth::{AuthService, SetupToken};
use mcm_config::Config;
use mcm_core::auth::AuthRepo;
use mcm_db::{Database, SqliteAuthRepo, SqliteJobRepo, SqliteServerRepo};
use mcm_jobs::JobManager;
use std::{fs::File, sync::Arc};

#[derive(Debug, thiserror::Error)]
pub enum WiringError {
    #[error(transparent)]
    Config(#[from] mcm_config::ConfigError),
    #[error(transparent)]
    Database(#[from] mcm_db::DatabaseError),
    #[error(transparent)]
    Auth(#[from] mcm_auth::AuthError),
    #[error(transparent)]
    Job(#[from] mcm_core::jobs::JobError),
    #[error(transparent)]
    Download(#[from] mcm_download::DownloadError),
    #[error(transparent)]
    Storage(#[from] mcm_core::repository::RepositoryError),
    #[error(transparent)]
    Io(#[from] std::io::Error),
}
pub struct Backend {
    pub state: AppState,
    pub database: Database,
    pub jobs: Arc<JobManager>,
    operations: Arc<mcm_process::Operations>,
    _lock: File,
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
    let software = Arc::new(
        mcm_install::Installers::new()?.with_curseforge(config.curseforge.api_key.clone()),
    );
    let runtime = Arc::new(mcm_process::DockerRuntime::new(
        config.docker.clone(),
        crate::storage::instance_id(&config.data_dir)?,
    ));
    let operations_repo = Arc::new(mcm_db::SqliteOperationsRepo::new(&database));
    if config.data_dir.join("servers").is_dir()
        && let Err(error) = runtime.recover_installers().await
        && !matches!(error, mcm_core::server::ServerError::DockerUnavailable)
    {
        tracing::warn!(%error,"could not recover interrupted loader installers");
    }
    let servers = Arc::new(
        mcm_process::ServerManager::new(
            config.data_dir.join("servers"),
            config.docker.runtime_image.clone(),
            Arc::new(SqliteServerRepo::new(&database)),
            runtime,
        )
        .with_installers(software.clone())
        .with_properties(Arc::new(mcm_db::SqlitePropertiesRepo::new(&database)))
        .with_operations(operations_repo.clone()),
    );
    servers.recover_transitions().await.map_err(|_| {
        std::io::Error::other(
            "Instance transition recovery failed; original files and journals were retained.",
        )
    })?;
    let exports = Arc::new(mcm_process::ExportManager::new(
        config.data_dir.join("exports"),
        servers.clone(),
    )?);
    let connect_host = config.docker.connect_host.clone().unwrap_or_else(|| {
        url::Url::parse(&config.origin().unwrap_or_default())
            .ok()
            .and_then(|u| u.host_str().map(str::to_owned))
            .unwrap_or_default()
    });
    let operations = Arc::new(mcm_process::Operations::new(
        operations_repo,
        servers.clone(),
        servers.clone(),
        servers.clone(),
        exports.clone(),
        connect_host,
    )?);
    let state = AppState {
        operations: operations.clone(),
        metrics: Arc::new(mcm_api::MetricsHub::new()),
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
