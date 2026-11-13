use mcm_api::AppState;
use mcm_auth::{AuthService, SetupToken};
use mcm_config::Config;
use mcm_core::auth::AuthRepo;
use mcm_db::{Database, SqliteAuthRepo, SqliteJavaRuntimeRepo, SqliteJobRepo, SqliteServerRepo};
use mcm_download::SafeHttp;
use mcm_java::{Adoptium, JavaManager};
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
    _lock: File,
}
impl Backend {
    pub async fn shutdown(&self) {
        self.jobs.shutdown().await;
        self.database.close().await;
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
    let http = SafeHttp::adoptium()?;
    let java = Arc::new(JavaManager::new(
        config.data_dir.join("runtimes/java"),
        Arc::new(SqliteJavaRuntimeRepo::new(&database)),
        Arc::new(Adoptium::new(http.clone())),
        http,
    ));
    let servers = Arc::new(mcm_process::ServerManager::new(
        config.data_dir.join("servers"),
        config.docker.runtime_image.clone(),
        Arc::new(SqliteServerRepo::new(&database)),
        Arc::new(mcm_process::DockerRuntime::new(
            config.docker.clone(),
            crate::storage::instance_id(&config.data_dir)?,
        )),
    ));
    let state = AppState {
        servers,
        health: Arc::new(database.clone()),
        auth_enabled: config.auth.enabled,
        show_version: config.http.show_version,
        auth,
        java,
        jobs: jobs.clone(),
        origin: config.origin()?,
        secure_cookie: config.secure_cookie(),
        allow_system_java: config.java.allow_system_java,
    };
    Ok(Backend {
        state,
        database,
        jobs,
        _lock: lock,
    })
}
