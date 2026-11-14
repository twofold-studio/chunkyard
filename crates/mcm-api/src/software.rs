use crate::{AppState, error::ApiError};
use axum::{
    Json,
    extract::{Path, Query, State},
};
use serde_json::Value;
pub(crate) async fn modpack(
    State(s): State<AppState>,
    Path(id): Path<u64>,
) -> Result<Json<Value>, ApiError> {
    Ok(Json(s.software.modpack(id).await?))
}
pub(crate) async fn modpack_logo(
    State(s): State<AppState>,
    Path(id): Path<u64>,
) -> Result<axum::response::Response, ApiError> {
    Ok(crate::icons::png(s.software.modpack_logo(id).await?))
}
#[derive(serde::Deserialize, Default)]
#[serde(default, deny_unknown_fields)]
pub(crate) struct Search {
    query: String,
    index: u32,
}
pub(crate) async fn modpacks(
    State(s): State<AppState>,
    Query(q): Query<Search>,
) -> Result<Json<Value>, ApiError> {
    Ok(Json(s.software.search_modpacks(&q.query, q.index).await?))
}
pub(crate) async fn modpack_files(
    State(s): State<AppState>,
    Path(id): Path<u64>,
) -> Result<Json<Value>, ApiError> {
    Ok(Json(s.software.modpack_files(id).await?))
}
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
