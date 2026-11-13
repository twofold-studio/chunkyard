//! HTTP transport. Services and configuration arrive through the composition root.
mod auth;
mod error;
mod java;
mod json;
mod security;
mod servers;
mod state;
use axum::{
    Router, middleware,
    routing::{get, post},
};
pub use state::AppState;

pub fn router(state: AppState) -> Router {
    let protected = Router::new()
        .route("/api/v1/servers", get(servers::list).post(servers::create))
        .route("/api/v1/servers/{id}", get(servers::get))
        .route("/api/v1/servers/{id}/eula", post(servers::eula))
        .route("/api/v1/servers/{id}/start", post(servers::start))
        .route("/api/v1/servers/{id}/stop", post(servers::stop))
        .route("/api/v1/servers/{id}/restart", post(servers::restart))
        .route("/api/v1/servers/{id}/kill", post(servers::kill))
        .route("/api/v1/servers/{id}/console", get(servers::logs))
        .route(
            "/api/v1/servers/{id}/console/commands",
            post(servers::command),
        )
        .route("/api/v1/system/isolation", get(servers::isolation))
        .route("/api/v1/auth/me", get(auth::me))
        .route("/api/v1/auth/logout", post(auth::logout))
        .route("/api/v1/java/runtimes", get(java::list))
        .route("/api/v1/java/runtimes/discover", post(java::discover))
        .route("/api/v1/java/available", get(java::available))
        .route("/api/v1/java/runtimes/install", post(java::install))
        .route("/api/v1/jobs", get(java::jobs))
        .route("/api/v1/jobs/{id}", get(java::job))
        .route_layer(middleware::from_fn_with_state(
            state.clone(),
            auth::require_session,
        ));
    Router::new()
        .merge(protected)
        .route("/healthz", get(auth::health))
        .route("/api/v1/setup/status", get(auth::setup_status))
        .route("/api/v1/setup", post(auth::setup))
        .route("/api/v1/auth/login", post(auth::login))
        .fallback(error::not_found)
        .method_not_allowed_fallback(error::method_not_allowed)
        .layer(axum::extract::DefaultBodyLimit::max(1024 * 1024))
        .layer(middleware::from_fn_with_state(
            state.clone(),
            security::secure,
        ))
        .with_state(state)
}
