use crate::{AppState, error::ApiError};
use axum::{
    Json, Router,
    body::Bytes,
    extract::{DefaultBodyLimit, Path, State, rejection::BytesRejection},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
    routing::get,
};
use mcm_core::server::ServerError;
use serde_json::{Value, json};

pub(crate) fn routes() -> Router<AppState> {
    Router::new()
        .route(
            "/api/v1/servers/{id}/icon",
            get(icon).put(upload).delete(reset),
        )
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
async fn icon(State(state): State<AppState>, Path(id): Path<String>) -> Result<Response, ApiError> {
    Ok(png(state.servers.icon(&id).await?))
}
async fn upload(
    State(state): State<AppState>,
    Path(id): Path<String>,
    body: Result<Bytes, BytesRejection>,
) -> Result<Json<Value>, ApiError> {
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
    Ok(Json(
        json!({"server":state.servers.set_icon(&id, body.to_vec()).await?}),
    ))
}
async fn reset(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    Ok(Json(json!({"server":state.servers.reset_icon(&id).await?})))
}
