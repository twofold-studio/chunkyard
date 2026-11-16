use crate::*;
use axum::{
    Router, middleware,
    routing::{get, post},
};

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
        .merge(operations::routes())
        .merge(icons::routes())
        .merge(files::routes())
        .merge(exports::routes())
        .route(
            "/api/v1/servers/{id}/resources",
            axum::routing::patch(servers::set_resources),
        )
        .merge(properties::routes())
        .route(
            "/api/v1/servers/{id}/console/stream",
            get(console_stream::upgrade),
        )
        .route(
            "/api/v1/servers/{id}/network",
            get(servers::network).patch(servers::set_network),
        )
        .route("/api/v1/software", get(software::catalog))
        .route("/api/v1/modpacks/curseforge", get(software::modpacks))
        .route("/api/v1/modpacks/curseforge/{id}", get(software::modpack))
        .route(
            "/api/v1/modpacks/curseforge/{id}/logo",
            get(software::modpack_logo),
        )
        .route(
            "/api/v1/modpacks/curseforge/{id}/files",
            get(software::modpack_files),
        )
        .route(
            "/api/v1/servers/{id}/launch",
            get(servers::launch_settings).patch(servers::set_launch),
        )
        .route("/api/v1/software/{kind}/versions", get(software::versions))
        .route(
            "/api/v1/software/{kind}/versions/{version}/builds",
            get(software::builds),
        )
        .route("/api/v1/servers/{id}/install", post(servers::install))
        .route("/api/v1/servers/{id}/metrics", get(servers::metrics))
        .route(
            "/api/v1/servers/{id}/metrics/stream",
            get(metrics_stream::upgrade),
        )
        .route("/api/v1/servers", get(servers::list).post(servers::create))
        .route(
            "/api/v1/servers/{id}",
            get(servers::get).delete(servers::delete),
        )
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
        .route(
            "/api/v1/auth/api-keys",
            get(auth::api_keys).post(auth::create_api_key),
        )
        .route(
            "/api/v1/auth/api-keys/{id}",
            axum::routing::delete(auth::revoke_api_key),
        )
        .route("/api/v1/jobs", get(jobs::jobs))
        .route("/api/v1/jobs/{id}", get(jobs::job))
        .route_layer(middleware::from_fn_with_state(
            state.clone(),
            auth::require_session,
        ));
    Router::new()
        .merge(protected)
        .route(
            "/mcp",
            post(mcp::handle).layer(axum::extract::DefaultBodyLimit::max(1024 * 1024)),
        )
        .route("/healthz", get(auth::health))
        .route("/api/v1/openapi.json", get(openapi::document))
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
