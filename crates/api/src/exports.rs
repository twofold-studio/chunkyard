use crate::dto::*;
use crate::{AppState, error::ApiError, json::ApiJson};
use axum::{
    Extension, Json,
    body::Body,
    extract::{Path, State},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
};
use chunkyard_core::{auth::Actor, exports::*, jobs::JobFailure};
use futures_util::StreamExt;
use serde_json::json;
use std::sync::Arc;
static DOWNLOADS: std::sync::LazyLock<Arc<tokio::sync::Semaphore>> =
    std::sync::LazyLock::new(|| Arc::new(tokio::sync::Semaphore::new(4)));
pub(crate) fn routes() -> utoipa_axum::router::OpenApiRouter<AppState> {
    utoipa_axum::router::OpenApiRouter::new()
        .routes(utoipa_axum::routes!(storage, set_storage))
        .routes(utoipa_axum::routes!(test_storage))
        .routes(utoipa_axum::routes!(list))
        .routes(utoipa_axum::routes!(create))
        .routes(utoipa_axum::routes!(archive_instance))
        .routes(utoipa_axum::routes!(restore_instance))
        .routes(utoipa_axum::routes!(download))
        .routes(utoipa_axum::routes!(delete))
}
#[utoipa::path(post, path = "/api/v1/servers/{id}/archive", operation_id = "exports_archive_instance", tag = "exports", params(("id" = String, Path)), request_body = ArchiveRequest, responses((status = 202, description = "Success", body = JobResponse), (status = "default", description = "Request rejected", body = crate::error::Problem, content_type = "application/problem+json"))) ]
async fn archive_instance(
    State(s): State<AppState>,
    Extension(actor): Extension<Actor>,
    Path(id): Path<String>,
    ApiJson(body): ApiJson<ArchiveRequest>,
) -> Result<(StatusCode, Json<JobResponse>), ApiError> {
    s.servers.get(&id).await?;
    let service = s.exports.clone();
    let server = id.clone();
    let progress = chunkyard_core::progress::ProgressReporter::default();
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
    Ok((StatusCode::ACCEPTED, Json(JobResponse { job })))
}
#[utoipa::path(post, path = "/api/v1/exports/{id}/restore", operation_id = "exports_restore_instance", tag = "exports", params(("id" = String, Path)), responses((status = 202, description = "Success", body = JobResponse), (status = "default", description = "Request rejected", body = crate::error::Problem, content_type = "application/problem+json"))) ]
async fn restore_instance(
    State(s): State<AppState>,
    Extension(actor): Extension<Actor>,
    Path(id): Path<String>,
) -> Result<(StatusCode, Json<JobResponse>), ApiError> {
    let record = s.exports.get(&id).await?;
    let service = s.exports.clone();
    let progress = chunkyard_core::progress::ProgressReporter::default();
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
    Ok((StatusCode::ACCEPTED, Json(JobResponse { job })))
}
#[utoipa::path(get, path = "/api/v1/storage", operation_id = "exports_storage", tag = "exports", responses((status = 200, description = "Success", body = StorageView), (status = "default", description = "Request rejected", body = crate::error::Problem, content_type = "application/problem+json"))) ]
async fn storage(State(s): State<AppState>) -> Result<Json<StorageView>, ApiError> {
    Ok(Json(s.exports.storage().await?))
}
#[utoipa::path(put, path = "/api/v1/storage", operation_id = "exports_set_storage", tag = "exports", request_body = StorageConnection, responses((status = 200, description = "Success", body = StorageView), (status = "default", description = "Request rejected", body = crate::error::Problem, content_type = "application/problem+json"))) ]
async fn set_storage(
    State(s): State<AppState>,
    ApiJson(body): ApiJson<StorageConnection>,
) -> Result<Json<StorageView>, ApiError> {
    Ok(Json(s.exports.set_storage(body).await?))
}
#[utoipa::path(post, path = "/api/v1/storage/test", operation_id = "exports_test_storage", tag = "exports", responses((status = 200, description = "Success", body = StorageTest), (status = "default", description = "Request rejected", body = crate::error::Problem, content_type = "application/problem+json"))) ]
async fn test_storage(State(s): State<AppState>) -> Result<Json<StorageTest>, ApiError> {
    s.exports.test_storage().await?;
    Ok(Json(StorageTest { ok: true }))
}
#[utoipa::path(get, path = "/api/v1/exports", operation_id = "exports_list", tag = "exports", responses((status = 200, description = "Success", body = Items<Export>), (status = "default", description = "Request rejected", body = crate::error::Problem, content_type = "application/problem+json"))) ]
async fn list(State(s): State<AppState>) -> Result<Json<Items<Export>>, ApiError> {
    Ok(Json(Items {
        items: s.exports.list().await?,
    }))
}
#[utoipa::path(post, path = "/api/v1/servers/{id}/exports", operation_id = "exports_create", tag = "exports", params(("id" = String, Path)), request_body = ExportRequest, responses((status = 202, description = "Success", body = JobResponse), (status = "default", description = "Request rejected", body = crate::error::Problem, content_type = "application/problem+json"))) ]
async fn create(
    State(s): State<AppState>,
    Extension(actor): Extension<Actor>,
    Path(id): Path<String>,
    ApiJson(body): ApiJson<ExportRequest>,
) -> Result<(StatusCode, Json<JobResponse>), ApiError> {
    // Check the instance exists before accepting a durable job.
    s.servers.get(&id).await?;
    let service = s.exports.clone();
    let progress = chunkyard_core::progress::ProgressReporter::default();
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
    Ok((StatusCode::ACCEPTED, Json(JobResponse { job })))
}
#[utoipa::path(get, path = "/api/v1/exports/{id}/download", operation_id = "exports_download", tag = "exports", params(("id" = String, Path)), responses((status = 200, description = "Binary response", body = crate::dto::BinaryBody, content_type = "application/gzip"), (status = "default", description = "Request rejected", body = crate::error::Problem, content_type = "application/problem+json"))) ]
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
#[utoipa::path(delete, path = "/api/v1/exports/{id}", operation_id = "exports_delete", tag = "exports", params(("id" = String, Path)), responses((status = 204, description = "Success"), (status = "default", description = "Request rejected", body = crate::error::Problem, content_type = "application/problem+json"))) ]
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
