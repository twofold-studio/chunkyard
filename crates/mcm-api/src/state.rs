use mcm_auth::AuthService;
use mcm_core::jobs::JobService;
use std::sync::Arc;

#[derive(Clone)]
pub struct AppState {
    pub metrics: Arc<crate::MetricsHub>,
    pub operations: Arc<dyn mcm_core::operations::OperationsService>,
    pub health: Arc<dyn mcm_core::system::HealthCheck>,
    pub auth_enabled: bool,
    pub show_version: bool,
    pub auth: Arc<AuthService>,
    pub software: Arc<dyn mcm_core::software::SoftwareService>,
    pub servers: Arc<dyn mcm_core::server::ServerService>,
    pub files: Arc<dyn mcm_core::files::FileService>,
    pub properties: Arc<dyn mcm_core::properties::PropertiesService>,
    pub exports: Arc<dyn mcm_core::exports::ExportService>,
    pub jobs: Arc<dyn JobService>,
    pub origin: String,
    pub secure_cookie: bool,
}
