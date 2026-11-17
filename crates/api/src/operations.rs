use crate::dto::*;
use crate::{AppState, error::ApiError, json::ApiJson};
use axum::{
    Extension, Json,
    extract::{Path, Query, State},
    http::StatusCode,
};
use chunkyard_core::{auth::Actor, jobs::JobFailure, operations::*};
use serde::Deserialize;
use serde_json::json;

pub(crate) fn routes() -> utoipa_axum::router::OpenApiRouter<AppState> {
    utoipa_axum::router::OpenApiRouter::new()
        .routes(utoipa_axum::routes!(status))
        .routes(utoipa_axum::routes!(players, change_player))
        .routes(utoipa_axum::routes!(automation))
        .routes(utoipa_axum::routes!(recovery))
        .routes(utoipa_axum::routes!(backup))
        .routes(utoipa_axum::routes!(history))
        .routes(utoipa_axum::routes!(history_settings))
}
#[utoipa::path(get, path = "/api/v1/servers/{id}/status", operation_id = "operations_status", tag = "operations", params(("id" = String, Path)), responses((status = 200, description = "Success", body = GameStatus), (status = "default", description = "Request rejected", body = crate::error::Problem, content_type = "application/problem+json"))) ]
async fn status(
    State(s): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<GameStatus>, ApiError> {
    Ok(Json(s.operations.status(&id).await?))
}
#[utoipa::path(get, path = "/api/v1/servers/{id}/players", operation_id = "operations_players", tag = "operations", params(("id" = String, Path)), responses((status = 200, description = "Success", body = PlayerLists), (status = "default", description = "Request rejected", body = crate::error::Problem, content_type = "application/problem+json"))) ]
async fn players(
    State(s): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<PlayerLists>, ApiError> {
    Ok(Json(s.operations.players(&id).await?))
}
#[utoipa::path(get, path = "/api/v1/servers/{id}/automation", operation_id = "operations_automation", tag = "operations", params(("id" = String, Path)), responses((status = 200, description = "Success", body = AutomationState), (status = "default", description = "Request rejected", body = crate::error::Problem, content_type = "application/problem+json"))) ]
async fn automation(
    State(s): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<AutomationState>, ApiError> {
    Ok(Json(s.operations.automation(&id).await?))
}
#[utoipa::path(put, path = "/api/v1/servers/{id}/recovery", operation_id = "operations_recovery", tag = "operations", params(("id" = String, Path)), request_body = RecoveryPolicyRequest, responses((status = 200, description = "Success", body = AutomationState), (status = "default", description = "Request rejected", body = crate::error::Problem, content_type = "application/problem+json"))) ]
async fn recovery(
    State(s): State<AppState>,
    Path(id): Path<String>,
    ApiJson(policy): ApiJson<RecoveryPolicyRequest>,
) -> Result<Json<AutomationState>, ApiError> {
    Ok(Json(s.operations.set_recovery(&id, policy.into()).await?))
}
#[utoipa::path(put, path = "/api/v1/servers/{id}/backup-schedule", operation_id = "operations_backup", tag = "operations", params(("id" = String, Path)), request_body = BackupPolicyWrite, responses((status = 200, description = "Success", body = AutomationState), (status = "default", description = "Request rejected", body = crate::error::Problem, content_type = "application/problem+json"))) ]
async fn backup(
    State(s): State<AppState>,
    Path(id): Path<String>,
    ApiJson(policy): ApiJson<BackupPolicyWrite>,
) -> Result<Json<AutomationState>, ApiError> {
    Ok(Json(s.operations.set_backup(&id, policy).await?))
}
#[derive(Deserialize, utoipa::ToSchema, utoipa::IntoParams)]
#[serde(deny_unknown_fields)]
#[into_params(parameter_in = Query)]
struct HistoryQuery {
    hours: Option<u32>,
}
#[utoipa::path(get, path = "/api/v1/servers/{id}/metrics/history", operation_id = "operations_history", tag = "operations", params(("id" = String, Path), HistoryQuery), responses((status = 200, description = "Success", body = MetricsHistory), (status = "default", description = "Request rejected", body = crate::error::Problem, content_type = "application/problem+json"))) ]
async fn history(
    State(s): State<AppState>,
    Path(id): Path<String>,
    query: Result<Query<HistoryQuery>, axum::extract::rejection::QueryRejection>,
) -> Result<Json<MetricsHistory>, ApiError> {
    let Query(query) = query.map_err(|_| {
        ApiError::new(
            StatusCode::BAD_REQUEST,
            "operations.invalid",
            "Invalid history range.",
        )
    })?;
    Ok(Json(
        s.operations.history(&id, query.hours.unwrap_or(24)).await?,
    ))
}
#[derive(Deserialize, utoipa::ToSchema)]
#[serde(deny_unknown_fields)]
struct HistorySettings {
    enabled: bool,
}
#[utoipa::path(put, path = "/api/v1/servers/{id}/metrics/history-settings", operation_id = "operations_history_settings", tag = "operations", params(("id" = String, Path)), request_body = HistorySettings, responses((status = 200, description = "Success", body = AutomationState), (status = "default", description = "Request rejected", body = crate::error::Problem, content_type = "application/problem+json"))) ]
async fn history_settings(
    State(s): State<AppState>,
    Path(id): Path<String>,
    ApiJson(settings): ApiJson<HistorySettings>,
) -> Result<Json<AutomationState>, ApiError> {
    Ok(Json(s.operations.set_history(&id, settings.enabled).await?))
}
#[utoipa::path(post, path = "/api/v1/servers/{id}/players", operation_id = "operations_change_player", tag = "operations", params(("id" = String, Path)), request_body = PlayerChange, responses((status = 202, description = "Success", body = JobResponse), (status = "default", description = "Request rejected", body = crate::error::Problem, content_type = "application/problem+json"))) ]
async fn change_player(
    State(s): State<AppState>,
    Path(id): Path<String>,
    Extension(actor): Extension<Actor>,
    ApiJson(change): ApiJson<PlayerChange>,
) -> Result<(StatusCode, Json<JobResponse>), ApiError> {
    s.servers.get(&id).await?;
    let operations = s.operations.clone();
    let server_id = id.clone();
    let task = Box::pin(async move {
        operations
            .change_player(&server_id, change)
            .await
            .map(|players| json!({"players":players}))
            .map_err(|e| JobFailure {
                code: e.code().into(),
                detail: e.public_detail().into(),
            })
    });
    let job = s
        .jobs
        .submit_for_server("server.players", &id, actor.user_id(), task)
        .await?;
    Ok((StatusCode::ACCEPTED, Json(JobResponse { job })))
}

impl From<OperationsError> for ApiError {
    fn from(error: OperationsError) -> Self {
        match error {
            OperationsError::Server(e) => e.into(),
            OperationsError::Files(e) => e.into(),
            OperationsError::Export(e) => e.into(),
            OperationsError::Storage(e) => Self::internal(e),
            other => Self::new(
                if matches!(other, OperationsError::Busy) {
                    StatusCode::TOO_MANY_REQUESTS
                } else {
                    StatusCode::UNPROCESSABLE_ENTITY
                },
                other.code(),
                other.public_detail(),
            ),
        }
    }
}
