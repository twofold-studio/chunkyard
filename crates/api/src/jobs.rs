use crate::{AppState, error::ApiError};
use axum::{
    Json,
    extract::{Path, Query, State},
    http::StatusCode,
};
use serde::Deserialize;

#[derive(Deserialize, utoipa::ToSchema, utoipa::IntoParams)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
#[into_params(parameter_in = Query)]
pub(crate) struct JobsQuery {
    limit: Option<u32>,
    cursor: Option<String>,
    server_id: Option<uuid::Uuid>,
    #[serde(default)]
    active_only: bool,
}

#[utoipa::path(get, path = "/api/v1/jobs", operation_id = "jobs_jobs", tag = "jobs", params(JobsQuery), responses((status = 200, description = "Success", body = chunkyard_core::jobs::JobPage), (status = "default", description = "Request rejected", body = crate::error::Problem, content_type = "application/problem+json"))) ]
pub(crate) async fn jobs(
    State(state): State<AppState>,
    query: Result<Query<JobsQuery>, axum::extract::rejection::QueryRejection>,
) -> Result<Json<chunkyard_core::jobs::JobPage>, ApiError> {
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
    Ok(Json(
        state
            .jobs
            .list_filtered(
                limit,
                query.cursor.as_deref(),
                server_id.as_deref(),
                query.active_only,
            )
            .await?,
    ))
}
#[utoipa::path(get, path = "/api/v1/jobs/{id}", operation_id = "jobs_job", tag = "jobs", params(("id" = String, Path)), responses((status = 200, description = "Success", body = chunkyard_core::jobs::Job), (status = "default", description = "Request rejected", body = crate::error::Problem, content_type = "application/problem+json"))) ]
pub(crate) async fn job(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<chunkyard_core::jobs::Job>, ApiError> {
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
    Ok(Json(job))
}
