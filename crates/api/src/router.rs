use crate::*;
use axum::{Router, middleware, routing::post};
use utoipa_axum::router::OpenApiRouter;

pub fn router(state: AppState) -> Router {
    secure_router(routes(state.clone()), state)
}

/// Host/Origin/CSRF protections apply equally in both authentication modes.
pub fn secure_router(router: Router, state: AppState) -> Router {
    router.layer(middleware::from_fn_with_state(state, security::secure))
}

/// This same registration constructs the production router and offline contract.
pub(crate) fn protected_routes() -> OpenApiRouter<AppState> {
    utoipa_axum::router::OpenApiRouter::new()
        .merge(operations::routes())
        .merge(icons::routes())
        .merge(files::routes())
        .merge(exports::routes())
        .routes(utoipa_axum::routes!(servers::set_resources))
        .merge(properties::routes())
        .routes(utoipa_axum::routes!(console_stream::upgrade))
        .routes(utoipa_axum::routes!(servers::network, servers::set_network))
        .routes(utoipa_axum::routes!(software::catalog))
        .routes(utoipa_axum::routes!(software::modpacks))
        .routes(utoipa_axum::routes!(software::modpack))
        .routes(utoipa_axum::routes!(software::modpack_logo))
        .routes(utoipa_axum::routes!(software::modpack_files))
        .routes(utoipa_axum::routes!(
            servers::launch_settings,
            servers::set_launch
        ))
        .routes(utoipa_axum::routes!(software::versions))
        .routes(utoipa_axum::routes!(software::builds))
        .routes(utoipa_axum::routes!(servers::install))
        .routes(utoipa_axum::routes!(servers::metrics))
        .routes(utoipa_axum::routes!(metrics_stream::upgrade))
        .routes(utoipa_axum::routes!(servers::list, servers::create))
        .routes(utoipa_axum::routes!(servers::get, servers::delete))
        .routes(utoipa_axum::routes!(servers::eula))
        .routes(utoipa_axum::routes!(servers::start))
        .routes(utoipa_axum::routes!(servers::stop))
        .routes(utoipa_axum::routes!(servers::restart))
        .routes(utoipa_axum::routes!(servers::kill))
        .routes(utoipa_axum::routes!(servers::logs))
        .routes(utoipa_axum::routes!(servers::command))
        .routes(utoipa_axum::routes!(servers::isolation))
        .routes(utoipa_axum::routes!(auth::me))
        .routes(utoipa_axum::routes!(auth::logout))
        .routes(utoipa_axum::routes!(auth::api_keys, auth::create_api_key))
        .routes(utoipa_axum::routes!(auth::revoke_api_key))
        .routes(utoipa_axum::routes!(jobs::jobs))
        .routes(utoipa_axum::routes!(jobs::job))
}
pub(crate) fn public_routes() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(utoipa_axum::routes!(auth::health))
        .routes(utoipa_axum::routes!(openapi::document))
        .routes(utoipa_axum::routes!(version::version))
        .routes(utoipa_axum::routes!(version::changelog))
        .routes(utoipa_axum::routes!(auth::setup_status))
        .routes(utoipa_axum::routes!(auth::setup))
        .routes(utoipa_axum::routes!(auth::verify_setup_token))
        .routes(utoipa_axum::routes!(auth::login))
}
pub fn routes(state: AppState) -> Router {
    let (protected, _) = protected_routes().split_for_parts();
    let (public, _) = public_routes().split_for_parts();
    public
        .merge(protected.route_layer(middleware::from_fn_with_state(
            state.clone(),
            auth::require_session,
        )))
        .route(
            "/mcp",
            post(mcp::handle).layer(axum::extract::DefaultBodyLimit::max(1024 * 1024)),
        )
        .route("/api", axum::routing::any(error::not_found))
        .route("/api/", axum::routing::any(error::not_found))
        .route("/api/{*path}", axum::routing::any(error::not_found))
        .fallback(error::not_found)
        .method_not_allowed_fallback(error::method_not_allowed)
        .layer(axum::extract::DefaultBodyLimit::max(1024 * 1024))
        .with_state(state)
}
