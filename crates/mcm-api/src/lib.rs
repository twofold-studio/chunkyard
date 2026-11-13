//! HTTP transport. Services and configuration arrive through the composition root.
mod auth;
mod error;
mod java;
mod json;
mod openapi;
mod security;
mod servers;
mod state;
mod version;
use axum::{
    Router, middleware,
    routing::{get, post},
};
pub use state::AppState;

pub fn router(state: AppState) -> Router {
    secure_router(routes(state.clone()), state)
}

/// Apply the same Host/Origin/CSRF checks to both API and static page routes.
pub fn secure_router(router: Router, state: AppState) -> Router {
    router.layer(middleware::from_fn_with_state(state, security::secure))
}

/// API routes without global middleware, for composition with a static SPA fallback.
pub fn routes(state: AppState) -> Router {
    let protected = Router::new()
        .route("/api/v1/openapi.json", get(openapi::document))
        .route("/api/v1/servers/{id}/metrics", get(servers::metrics))
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
        .route("/api/v1/system/version", get(version::version))
        .route("/api/v1/system/changelog", get(version::changelog))
        .route("/api/v1/setup/status", get(auth::setup_status))
        .route("/api/v1/setup", post(auth::setup))
        .route("/api/v1/setup/verify-token", post(auth::verify_setup_token))
        .route("/api/v1/auth/login", post(auth::login))
        .route("/api", axum::routing::any(error::not_found))
        .route("/api/", axum::routing::any(error::not_found))
        .route("/api/{*path}", axum::routing::any(error::not_found))
        .fallback(error::not_found)
        .method_not_allowed_fallback(error::method_not_allowed)
        .layer(axum::extract::DefaultBodyLimit::max(1024 * 1024))
        .with_state(state)
}
