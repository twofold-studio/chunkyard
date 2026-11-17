use crate::dto::*;
use crate::{AppState, error::ApiError};
use axum::{
    Json,
    body::Bytes,
    extract::{DefaultBodyLimit, Path, State, rejection::BytesRejection},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
};
use chunkyard_core::server::ServerError;

pub(crate) fn routes() -> utoipa_axum::router::OpenApiRouter<AppState> {
    utoipa_axum::router::OpenApiRouter::new()
        .routes(utoipa_axum::routes!(icon, upload, reset))
        .layer(DefaultBodyLimit::max(2 * 1024 * 1024))
}

pub(crate) fn png(bytes: Vec<u8>) -> Response {
    (
        [
            (header::CONTENT_TYPE, "image/png"),
            (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
        ],
        bytes,
    )
        .into_response()
}
#[utoipa::path(get, path = "/api/v1/servers/{id}/icon", operation_id = "icons_icon", tag = "icons", params(("id" = String, Path)), responses((status = 200, description = "Binary response", body = crate::dto::BinaryBody, content_type = "image/png"), (status = "default", description = "Request rejected", body = crate::error::Problem, content_type = "application/problem+json"))) ]
async fn icon(State(state): State<AppState>, Path(id): Path<String>) -> Result<Response, ApiError> {
    Ok(png(state.servers.icon(&id).await?))
}
#[utoipa::path(put, path = "/api/v1/servers/{id}/icon", operation_id = "icons_upload", tag = "icons", params(("id" = String, Path)), request_body(content = crate::dto::BinaryBody, content_type = "application/octet-stream"), responses((status = 200, description = "Success", body = ServerResponse), (status = "default", description = "Request rejected", body = crate::error::Problem, content_type = "application/problem+json"))) ]
async fn upload(
    State(state): State<AppState>,
    Path(id): Path<String>,
    body: Result<Bytes, BytesRejection>,
) -> Result<Json<ServerResponse>, ApiError> {
    let body = body.map_err(|error| {
        if error.status() == StatusCode::PAYLOAD_TOO_LARGE {
            ApiError::from(ServerError::IconTooLarge)
        } else {
            ApiError::new(
                StatusCode::BAD_REQUEST,
                "icons.invalid",
                "The upload could not be read.",
            )
        }
    })?;
    Ok(Json(ServerResponse {
        server: state.servers.set_icon(&id, body.to_vec()).await?,
    }))
}
#[utoipa::path(delete, path = "/api/v1/servers/{id}/icon", operation_id = "icons_reset", tag = "icons", params(("id" = String, Path)), responses((status = 200, description = "Success", body = ServerResponse), (status = "default", description = "Request rejected", body = crate::error::Problem, content_type = "application/problem+json"))) ]
async fn reset(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<ServerResponse>, ApiError> {
    Ok(Json(ServerResponse {
        server: state.servers.reset_icon(&id).await?,
    }))
}
