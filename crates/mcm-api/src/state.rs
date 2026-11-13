use mcm_auth::AuthService;
use mcm_core::{java::JavaRuntimeService, jobs::JobService};
use std::sync::Arc;

#[derive(Clone)]
pub struct AppState {
    pub health: Arc<dyn mcm_core::system::HealthCheck>,
    pub auth_enabled: bool,
    pub show_version: bool,
    pub auth: Arc<AuthService>,
    pub servers: Arc<dyn mcm_core::server::ServerService>,
    pub java: Arc<dyn JavaRuntimeService>,
    pub jobs: Arc<dyn JobService>,
    pub origin: String,
    pub secure_cookie: bool,
    pub allow_system_java: bool,
}
