use crate::{AppState, error::ApiError, json::ApiJson};
use axum::{
    Json,
    extract::{DefaultBodyLimit, Path, Query, State},
    http::StatusCode,
};
use chunkyard_core::properties::*;
use serde::Deserialize;
use utoipa_axum::router::UtoipaMethodRouterExt;
pub(crate) fn routes() -> utoipa_axum::router::OpenApiRouter<AppState> {
    utoipa_axum::router::OpenApiRouter::new()
        .routes(utoipa_axum::routes!(read, save).layer(DefaultBodyLimit::max(8 * 1024 * 1024)))
        .routes(utoipa_axum::routes!(history))
        .routes(utoipa_axum::routes!(revision))
        .routes(utoipa_axum::routes!(restore))
}
#[utoipa::path(get, path = "/api/v1/servers/{id}/properties", operation_id = "properties_read", tag = "properties", params(("id" = String, Path)), responses((status = 200, description = "Success", body = PropertiesDocument), (status = "default", description = "Request rejected", body = crate::error::Problem, content_type = "application/problem+json"))) ]
async fn read(
    State(s): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<PropertiesDocument>, ApiError> {
    Ok(Json(s.properties.properties(&id).await?))
}
#[utoipa::path(put, path = "/api/v1/servers/{id}/properties", operation_id = "properties_save", tag = "properties", params(("id" = String, Path)), request_body = PropertiesWrite, responses((status = 200, description = "Success", body = PropertiesDocument), (status = "default", description = "Request rejected", body = crate::error::Problem, content_type = "application/problem+json"))) ]
async fn save(
    State(s): State<AppState>,
    Path(id): Path<String>,
    ApiJson(body): ApiJson<PropertiesWrite>,
) -> Result<Json<PropertiesDocument>, ApiError> {
    Ok(Json(s.properties.save_properties(&id, body).await?))
}
#[derive(Deserialize, utoipa::IntoParams)]
#[serde(deny_unknown_fields)]
#[into_params(parameter_in = Query)]
struct HistoryQuery {
    before: Option<i64>,
    #[serde(default = "limit")]
    limit: u32,
}
fn limit() -> u32 {
    50
}
#[utoipa::path(get, path = "/api/v1/servers/{id}/properties/versions", operation_id = "properties_history", tag = "properties", params(("id" = String, Path), HistoryQuery), responses((status = 400, description = "Axum path or query rejection", body = String, content_type = "text/plain"), (status = 200, description = "Success", body = PropertiesHistory), (status = "default", description = "Request rejected", body = crate::error::Problem, content_type = "application/problem+json"))) ]
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
#[utoipa::path(get, path = "/api/v1/servers/{id}/properties/versions/{version}", operation_id = "properties_revision", tag = "properties", params(("id" = String, Path), ("version" = i64, Path)), responses((status = 200, description = "Success", body = PropertiesRevision), (status = "default", description = "Request rejected", body = crate::error::Problem, content_type = "application/problem+json"))) ]
async fn revision(
    State(s): State<AppState>,
    Path((id, version)): Path<(String, i64)>,
) -> Result<Json<PropertiesRevision>, ApiError> {
    Ok(Json(s.properties.properties_revision(&id, version).await?))
}
#[utoipa::path(post, path = "/api/v1/servers/{id}/properties/restore", operation_id = "properties_restore", tag = "properties", params(("id" = String, Path)), request_body = PropertiesRestore, responses((status = 200, description = "Success", body = PropertiesDocument), (status = "default", description = "Request rejected", body = crate::error::Problem, content_type = "application/problem+json"))) ]
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
