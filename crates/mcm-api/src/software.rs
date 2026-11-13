use crate::{AppState, error::ApiError};
use axum::{
    Json,
    extract::{Path, State},
};
use serde_json::Value;
pub(crate) async fn catalog(State(state): State<AppState>) -> Json<Value> {
    Json(state.software.catalog())
}
pub(crate) async fn versions(
    State(state): State<AppState>,
    Path(kind): Path<String>,
) -> Result<Json<Value>, ApiError> {
    Ok(Json(state.software.versions(&kind).await?))
}
pub(crate) async fn builds(
    State(state): State<AppState>,
    Path((kind, version)): Path<(String, String)>,
) -> Result<Json<Value>, ApiError> {
    Ok(Json(state.software.builds(&kind, &version).await?))
}
