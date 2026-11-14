use crate::{AppState, error::ApiError, json::ApiJson};
use axum::{
    Extension, Json, Router,
    body::Body,
    extract::{Path, State},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use futures_util::StreamExt;
use mcm_core::{auth::Actor, exports::*, jobs::JobFailure};
use serde_json::{Value, json};
use std::sync::Arc;
static DOWNLOADS: std::sync::LazyLock<Arc<tokio::sync::Semaphore>> =
    std::sync::LazyLock::new(|| Arc::new(tokio::sync::Semaphore::new(4)));
pub(crate) fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/v1/storage", get(storage).put(set_storage))
        .route("/api/v1/storage/test", post(test_storage))
        .route("/api/v1/exports", get(list))
        .route("/api/v1/servers/{id}/exports", post(create))
        .route("/api/v1/servers/{id}/archive", post(archive_instance))
        .route("/api/v1/exports/{id}/restore", post(restore_instance))
        .route("/api/v1/exports/{id}/download", get(download))
        .route("/api/v1/exports/{id}", axum::routing::delete(delete))
}
async fn archive_instance(
    State(s): State<AppState>,
    Extension(actor): Extension<Actor>,
    Path(id): Path<String>,
    ApiJson(body): ApiJson<ArchiveRequest>,
) -> Result<impl IntoResponse, ApiError> {
    s.servers.get(&id).await?;
    let service = s.exports.clone();
    let server = id.clone();
    let progress = mcm_core::progress::ProgressReporter::default();
    let worker = progress.clone();
    let task = Box::pin(async move {
        service
            .archive_instance(&server, body, worker)
            .await
            .map(|server| json!({"server":server}))
            .map_err(|error| JobFailure {
                code: error.code().into(),
                detail: error.public_detail().into(),
            })
    });
    let job = s
        .jobs
        .submit_progress_for_server("server.archive", &id, actor.user_id(), task, progress)
        .await?;
    Ok((StatusCode::ACCEPTED, Json(json!({"job":job}))))
}
async fn restore_instance(
    State(s): State<AppState>,
    Extension(actor): Extension<Actor>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    let record = s.exports.get(&id).await?;
    let service = s.exports.clone();
    let progress = mcm_core::progress::ProgressReporter::default();
    let worker = progress.clone();
    let task = Box::pin(async move {
        service
            .restore_instance(&id, worker)
            .await
            .map(|server| json!({"server":server}))
            .map_err(|error| JobFailure {
                code: error.code().into(),
                detail: error.public_detail().into(),
            })
    });
    let job = s
        .jobs
        .submit_progress_for_server(
            "server.restore",
            &record.server_id,
            actor.user_id(),
            task,
            progress,
        )
        .await?;
    Ok((StatusCode::ACCEPTED, Json(json!({"job":job}))))
}
async fn storage(State(s): State<AppState>) -> Result<Json<StorageView>, ApiError> {
    Ok(Json(s.exports.storage().await?))
}
async fn set_storage(
    State(s): State<AppState>,
    ApiJson(body): ApiJson<StorageConnection>,
) -> Result<Json<StorageView>, ApiError> {
    Ok(Json(s.exports.set_storage(body).await?))
}
async fn test_storage(State(s): State<AppState>) -> Result<Json<Value>, ApiError> {
    s.exports.test_storage().await?;
    Ok(Json(json!({"ok":true})))
}
async fn list(State(s): State<AppState>) -> Result<Json<Value>, ApiError> {
    Ok(Json(json!({"items":s.exports.list().await?})))
}
async fn create(
    State(s): State<AppState>,
    Extension(actor): Extension<Actor>,
    Path(id): Path<String>,
    ApiJson(body): ApiJson<ExportRequest>,
) -> Result<impl IntoResponse, ApiError> {
    // Check the instance exists before accepting a durable job.
    s.servers.get(&id).await?;
    let service = s.exports.clone();
    let progress = mcm_core::progress::ProgressReporter::default();
    let worker_progress = progress.clone();
    let server = id.clone();
    let task = Box::pin(async move {
        let record = service
            .create_with_progress(&server, body, worker_progress)
            .await
            .map_err(|e| JobFailure {
                code: e.code().into(),
                detail: e.public_detail().into(),
            })?;
        serde_json::to_value(record).map_err(|_| JobFailure {
            code: "exports.storage".into(),
            detail: "Could not save export result.".into(),
        })
    });
    let job = s
        .jobs
        .submit_progress_for_server("server.export", &id, actor.user_id(), task, progress)
        .await?;
    Ok((StatusCode::ACCEPTED, Json(json!({"job":job}))))
}
async fn download(State(s): State<AppState>, Path(id): Path<String>) -> Result<Response, ApiError> {
    let permit = DOWNLOADS
        .clone()
        .try_acquire_owned()
        .map_err(|_| ExportError::Busy)?;
    let file = s.exports.download(&id).await?;
    let stream =
        futures_util::stream::unfold((file.stream, permit), |(mut stream, permit)| async move {
            stream.next().await.map(|chunk| (chunk, (stream, permit)))
        });
    // Generated archive names contain only ASCII UUID characters.
    Ok((
        [
            (header::CONTENT_TYPE, "application/gzip".to_owned()),
            (
                header::CONTENT_DISPOSITION,
                format!("attachment; filename=\"{}\"", file.name),
            ),
            (header::CONTENT_LENGTH, file.size.to_string()),
        ],
        Body::from_stream(stream),
    )
        .into_response())
}
async fn delete(State(s): State<AppState>, Path(id): Path<String>) -> Result<StatusCode, ApiError> {
    s.exports.delete(&id).await?;
    Ok(StatusCode::NO_CONTENT)
}
impl From<ExportError> for ApiError {
    fn from(e: ExportError) -> Self {
        let detail = e.public_detail();
        let (status, code) = match e {
            ExportError::BackupRequired => (StatusCode::CONFLICT, "exports.backup_required"),
            ExportError::RestoreConflict => (StatusCode::CONFLICT, "exports.restore_conflict"),
            ExportError::InvalidArchive => {
                (StatusCode::UNPROCESSABLE_ENTITY, "exports.invalid_archive")
            }
            ExportError::Server(e) => return e.into(),
            ExportError::Files(e) => return e.into(),
            ExportError::Invalid => (StatusCode::UNPROCESSABLE_ENTITY, "exports.invalid"),
            ExportError::NotFound => (StatusCode::NOT_FOUND, "exports.not_found"),
            ExportError::Limit => (StatusCode::PAYLOAD_TOO_LARGE, "exports.limit"),
            ExportError::Busy => (StatusCode::CONFLICT, "exports.busy"),
            ExportError::Storage => (StatusCode::BAD_GATEWAY, "exports.storage"),
            ExportError::Io(e) => {
                tracing::error!(%e,"archive IO failed");
                (StatusCode::INTERNAL_SERVER_ERROR, "exports.storage")
            }
        };
        Self::new(status, code, detail)
    }
}
