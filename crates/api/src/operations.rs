use crate::{AppState, error::ApiError, json::ApiJson};
use axum::{
    Extension, Json, Router,
    extract::{Path, Query, State},
    http::StatusCode,
    routing::{get, put},
};
use chunkyard_core::{auth::Actor, jobs::JobFailure, operations::*};
use serde::Deserialize;
use serde_json::{Value, json};

pub(crate) fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/v1/servers/{id}/status", get(status))
        .route(
            "/api/v1/servers/{id}/players",
            get(players).post(change_player),
        )
        .route("/api/v1/servers/{id}/automation", get(automation))
        .route("/api/v1/servers/{id}/recovery", put(recovery))
        .route("/api/v1/servers/{id}/backup-schedule", put(backup))
        .route("/api/v1/servers/{id}/metrics/history", get(history))
        .route(
            "/api/v1/servers/{id}/metrics/history-settings",
            put(history_settings),
        )
}
async fn status(
    State(s): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    Ok(Json(json!(s.operations.status(&id).await?)))
}
async fn players(
    State(s): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    Ok(Json(json!(s.operations.players(&id).await?)))
}
async fn automation(
    State(s): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    Ok(Json(json!(s.operations.automation(&id).await?)))
}
async fn recovery(
    State(s): State<AppState>,
    Path(id): Path<String>,
    ApiJson(policy): ApiJson<RecoveryPolicy>,
) -> Result<Json<Value>, ApiError> {
    Ok(Json(json!(s.operations.set_recovery(&id, policy).await?)))
}
async fn backup(
    State(s): State<AppState>,
    Path(id): Path<String>,
    ApiJson(policy): ApiJson<BackupPolicyWrite>,
) -> Result<Json<Value>, ApiError> {
    Ok(Json(json!(s.operations.set_backup(&id, policy).await?)))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct HistoryQuery {
    hours: Option<u32>,
}
async fn history(
    State(s): State<AppState>,
    Path(id): Path<String>,
    query: Result<Query<HistoryQuery>, axum::extract::rejection::QueryRejection>,
) -> Result<Json<Value>, ApiError> {
    let Query(query) = query.map_err(|_| {
        ApiError::new(
            StatusCode::BAD_REQUEST,
            "operations.invalid",
            "Invalid history range.",
        )
    })?;
    Ok(Json(json!(
        s.operations.history(&id, query.hours.unwrap_or(24)).await?
    )))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct HistorySettings {
    enabled: bool,
}
async fn history_settings(
    State(s): State<AppState>,
    Path(id): Path<String>,
    ApiJson(settings): ApiJson<HistorySettings>,
) -> Result<Json<Value>, ApiError> {
    Ok(Json(json!(
        s.operations.set_history(&id, settings.enabled).await?
    )))
}
async fn change_player(
    State(s): State<AppState>,
    Path(id): Path<String>,
    Extension(actor): Extension<Actor>,
    ApiJson(change): ApiJson<PlayerChange>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
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
    Ok((StatusCode::ACCEPTED, Json(json!({"job":job}))))
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
