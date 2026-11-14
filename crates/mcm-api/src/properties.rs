use crate::{AppState, error::ApiError, json::ApiJson};
use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, Path, Query, State},
    http::StatusCode,
    routing::{get, post},
};
use mcm_core::properties::*;
use serde::Deserialize;
pub(crate) fn routes() -> Router<AppState> {
    Router::new()
        .route(
            "/api/v1/servers/{id}/properties",
            get(read)
                .put(save)
                .layer(DefaultBodyLimit::max(8 * 1024 * 1024)),
        )
        .route("/api/v1/servers/{id}/properties/versions", get(history))
        .route(
            "/api/v1/servers/{id}/properties/versions/{version}",
            get(revision),
        )
        .route("/api/v1/servers/{id}/properties/restore", post(restore))
}
async fn read(
    State(s): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<PropertiesDocument>, ApiError> {
    Ok(Json(s.properties.properties(&id).await?))
}
async fn save(
    State(s): State<AppState>,
    Path(id): Path<String>,
    ApiJson(body): ApiJson<PropertiesWrite>,
) -> Result<Json<PropertiesDocument>, ApiError> {
    Ok(Json(s.properties.save_properties(&id, body).await?))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct HistoryQuery {
    before: Option<i64>,
    #[serde(default = "limit")]
    limit: u32,
}
fn limit() -> u32 {
    50
}
async fn history(
    State(s): State<AppState>,
    Path(id): Path<String>,
    Query(q): Query<HistoryQuery>,
) -> Result<Json<PropertiesHistory>, ApiError> {
    Ok(Json(
        s.properties
            .properties_history(&id, q.before, q.limit)
            .await?,
    ))
}
async fn revision(
    State(s): State<AppState>,
    Path((id, version)): Path<(String, i64)>,
) -> Result<Json<PropertiesRevision>, ApiError> {
    Ok(Json(s.properties.properties_revision(&id, version).await?))
}
async fn restore(
    State(s): State<AppState>,
    Path(id): Path<String>,
    ApiJson(body): ApiJson<PropertiesRestore>,
) -> Result<Json<PropertiesDocument>, ApiError> {
    Ok(Json(s.properties.restore_properties(&id, body).await?))
}
impl From<PropertiesError> for ApiError {
    fn from(e: PropertiesError) -> Self {
        use StatusCode as S;
        let (status, code, detail) = match e {
            PropertiesError::Conflict => (
                S::CONFLICT,
                "properties.conflict",
                "Properties changed since they were read. Reload before retrying.",
            ),
            PropertiesError::NotFound => (
                S::NOT_FOUND,
                "properties.not_found",
                "That configuration version does not exist.",
            ),
            PropertiesError::Invalid => (
                S::UNPROCESSABLE_ENTITY,
                "properties.invalid",
                "Use valid UTF-8 properties without NUL bytes and valid history limits.",
            ),
            PropertiesError::TooLarge => (
                S::PAYLOAD_TOO_LARGE,
                "properties.too_large",
                "Properties must not exceed 1 MiB.",
            ),
            PropertiesError::Server(e) => return e.into(),
            PropertiesError::File(e) => return e.into(),
            PropertiesError::Storage(e) => {
                tracing::error!(%e,"properties storage failed");
                (
                    S::INTERNAL_SERVER_ERROR,
                    "properties.storage",
                    "Configuration history could not be saved or loaded.",
                )
            }
        };
        Self::new(status, code, detail)
    }
}
