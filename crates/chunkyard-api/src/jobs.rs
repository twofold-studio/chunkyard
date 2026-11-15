use crate::{AppState, error::ApiError};
use axum::{
    Json,
    extract::{Path, Query, State},
    http::StatusCode,
};
use serde::Deserialize;
use serde_json::{Value, json};
#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct JobsQuery {
    limit: Option<u32>,
    cursor: Option<String>,
    server_id: Option<uuid::Uuid>,
    #[serde(default)]
    active_only: bool,
}

pub(crate) async fn jobs(
    State(state): State<AppState>,
    query: Result<Query<JobsQuery>, axum::extract::rejection::QueryRejection>,
) -> Result<Json<Value>, ApiError> {
    let Query(query) = query.map_err(|_| {
        ApiError::new(
            StatusCode::BAD_REQUEST,
            "validation",
            "The job list query is invalid.",
        )
    })?;
    let limit = query.limit.unwrap_or(50);
    if !(1..=200).contains(&limit) {
        return Err(ApiError::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            "validation",
            "limit must be between 1 and 200.",
        ));
    }
    let server_id = query.server_id.map(|id| id.to_string());
    Ok(Json(json!(
        state
            .jobs
            .list_filtered(
                limit,
                query.cursor.as_deref(),
                server_id.as_deref(),
                query.active_only
            )
            .await?
    )))
}
pub(crate) async fn job(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    if uuid::Uuid::parse_str(&id).is_err() {
        return Err(ApiError::new(
            StatusCode::NOT_FOUND,
            "job.not_found",
            "The job does not exist.",
        ));
    }
    let job = state.jobs.get(&id).await?.ok_or_else(|| {
        ApiError::new(
            StatusCode::NOT_FOUND,
            "job.not_found",
            "The job does not exist.",
        )
    })?;
    Ok(Json(json!(job)))
}
