use crate::{AppState, error::ApiError, json::ApiJson};
use axum::{
    Json, Router,
    body::Body,
    extract::{DefaultBodyLimit, Path, Query, State},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use chunkyard_core::files::*;
use futures_util::{StreamExt, stream};
use serde::Deserialize;
use serde_json::json;
use std::{io, sync::Arc, time::Duration};
use tokio::io::AsyncReadExt;
use tokio::sync::Semaphore;
use tokio_util::io::{ReaderStream, StreamReader, SyncIoBridge};

// Retained by each stream/worker until actual IO finishes, including cancellation.
static UPLOADS: std::sync::LazyLock<Arc<Semaphore>> =
    std::sync::LazyLock::new(|| Arc::new(Semaphore::new(4)));
static DOWNLOADS: std::sync::LazyLock<Arc<Semaphore>> =
    std::sync::LazyLock::new(|| Arc::new(Semaphore::new(4)));

pub(crate) fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/v1/servers/{id}/files", get(list))
        .route(
            "/api/v1/servers/{id}/files/content",
            get(content)
                .put(save)
                .layer(DefaultBodyLimit::max(8 * 1024 * 1024)),
        )
        .route("/api/v1/servers/{id}/files/download", get(download))
        .route("/api/v1/servers/{id}/files/upload", post(upload))
        .route("/api/v1/servers/{id}/files/mkdir", post(mkdir))
        .route("/api/v1/servers/{id}/files/move", post(move_entry))
        .route("/api/v1/servers/{id}/files/copy", post(copy))
        .route("/api/v1/servers/{id}/files/delete", post(delete))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct FilePath {
    #[serde(default)]
    path: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct UploadQuery {
    path: String,
    #[serde(default)]
    overwrite: bool,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct DeleteRequest {
    path: String,
    #[serde(default)]
    recursive: bool,
}

pub(crate) async fn list(
    State(s): State<AppState>,
    Path(id): Path<String>,
    Query(q): Query<FilePath>,
) -> Result<Json<FileListing>, ApiError> {
    Ok(Json(s.files.list(&id, q.path).await?))
}
pub(crate) async fn content(
    State(s): State<AppState>,
    Path(id): Path<String>,
    Query(q): Query<FilePath>,
) -> Result<Json<FileContent>, ApiError> {
    Ok(Json(s.files.content(&id, q.path).await?))
}
pub(crate) async fn save(
    State(s): State<AppState>,
    Path(id): Path<String>,
    Query(q): Query<FilePath>,
    ApiJson(body): ApiJson<WriteContent>,
) -> Result<Json<SavedFile>, ApiError> {
    Ok(Json(s.files.save(&id, q.path, body).await?))
}
pub(crate) async fn mkdir(
    State(s): State<AppState>,
    Path(id): Path<String>,
    ApiJson(body): ApiJson<FilePath>,
) -> Result<impl IntoResponse, ApiError> {
    Ok((
        StatusCode::CREATED,
        Json(json!({"entry":s.files.mkdir(&id, body.path).await?})),
    ))
}
pub(crate) async fn move_entry(
    State(s): State<AppState>,
    Path(id): Path<String>,
    ApiJson(body): ApiJson<Transfer>,
) -> Result<Json<serde_json::Value>, ApiError> {
    Ok(Json(
        json!({"entry":s.files.transfer(&id, body, false).await?}),
    ))
}
pub(crate) async fn copy(
    State(s): State<AppState>,
    Path(id): Path<String>,
    ApiJson(body): ApiJson<Transfer>,
) -> Result<Json<serde_json::Value>, ApiError> {
    Ok(Json(
        json!({"entry":s.files.transfer(&id, body, true).await?}),
    ))
}
pub(crate) async fn delete(
    State(s): State<AppState>,
    Path(id): Path<String>,
    ApiJson(body): ApiJson<DeleteRequest>,
) -> Result<StatusCode, ApiError> {
    s.files.delete(&id, body.path, body.recursive).await?;
    Ok(StatusCode::NO_CONTENT)
}
struct UploadReader<R> {
    source: R,
    _permit: tokio::sync::OwnedSemaphorePermit,
}
impl<R: io::Read> io::Read for UploadReader<R> {
    fn read(&mut self, bytes: &mut [u8]) -> io::Result<usize> {
        self.source.read(bytes)
    }
}
pub(crate) async fn upload(
    State(s): State<AppState>,
    Path(id): Path<String>,
    Query(q): Query<UploadQuery>,
    body: Body,
) -> Result<impl IntoResponse, ApiError> {
    let permit = UPLOADS
        .clone()
        .try_acquire_owned()
        .map_err(|_| capacity())?;
    let chunks = stream::unfold(body.into_data_stream(), |mut body| async move {
        let chunk = match tokio::time::timeout(Duration::from_secs(60), body.next()).await {
            Ok(Some(Ok(bytes))) => Ok(bytes),
            Ok(Some(Err(_))) => Err(io::Error::other("upload interrupted")),
            Ok(None) => return None,
            Err(_) => Err(io::Error::new(io::ErrorKind::TimedOut, "upload timed out")),
        };
        Some((chunk, body))
    });
    let source = UploadReader {
        source: SyncIoBridge::new(StreamReader::new(Box::pin(chunks))),
        _permit: permit,
    };
    let entry = s
        .files
        .upload(&id, q.path, q.overwrite, Box::new(source))
        .await?;
    Ok((StatusCode::CREATED, Json(json!({"entry":entry}))))
}
pub(crate) async fn download(
    State(s): State<AppState>,
    Path(id): Path<String>,
    Query(q): Query<FilePath>,
) -> Result<Response, ApiError> {
    let permit = DOWNLOADS
        .clone()
        .try_acquire_owned()
        .map_err(|_| capacity())?;
    let file = s.files.download(&id, q.path).await?;
    let reader = tokio::fs::File::from_std(file.file).take(file.size);
    let stream = ReaderStream::with_capacity(reader, 64 * 1024);
    let stream = stream::unfold((stream, permit), |(mut stream, permit)| async move {
        stream.next().await.map(|chunk| (chunk, (stream, permit)))
    });
    let encoded: String = url::form_urlencoded::byte_serialize(file.name.as_bytes())
        .collect::<String>()
        .replace('+', "%20");
    Ok((
        [
            (header::CONTENT_TYPE, "application/octet-stream".to_owned()),
            (
                header::CONTENT_DISPOSITION,
                format!("attachment; filename=\"download\"; filename*=UTF-8''{encoded}"),
            ),
            (header::CONTENT_LENGTH, file.size.to_string()),
        ],
        Body::from_stream(stream),
    )
        .into_response())
}
fn capacity() -> ApiError {
    ApiError::new(
        StatusCode::TOO_MANY_REQUESTS,
        "files.busy",
        "All file transfer slots are busy. Retry shortly.",
    )
}

impl From<FileError> for ApiError {
    fn from(e: FileError) -> Self {
        let e = match e {
            FileError::Server(error) => return error.into(),
            other => other,
        };
        use StatusCode as S;
        let (status, code) = match &e {
            FileError::Path => (S::UNPROCESSABLE_ENTITY, "files.path_invalid"),
            FileError::Symlink => (S::FORBIDDEN, "files.symlink"),
            FileError::Protected => (S::FORBIDDEN, "files.protected"),
            FileError::NotFound => (S::NOT_FOUND, "files.not_found"),
            FileError::Exists => (S::CONFLICT, "files.exists"),
            FileError::Conflict => (S::CONFLICT, "files.conflict"),
            FileError::NotEmpty => (S::CONFLICT, "files.not_empty"),
            FileError::Running => (S::CONFLICT, "files.server_running"),
            FileError::TooLarge => (S::PAYLOAD_TOO_LARGE, "files.too_large"),
            FileError::Binary => (S::UNSUPPORTED_MEDIA_TYPE, "files.binary"),
            FileError::Server(_) => (S::INTERNAL_SERVER_ERROR, "files.io"),
            FileError::Io(error) => {
                tracing::error!(%error, "instance file operation failed");
                (S::INTERNAL_SERVER_ERROR, "files.io")
            }
        };
        let detail = match e {
            FileError::Path => "Use an instance-relative path with valid file names.",
            FileError::Symlink => "Symbolic links cannot be traversed.",
            FileError::Protected => "This path is managed by Chunkyard and cannot be changed here.",
            FileError::NotFound => "The requested file or directory does not exist.",
            FileError::Exists => "The destination already exists.",
            FileError::Conflict => "This file changed since it was opened. Reload before saving.",
            FileError::NotEmpty => "Confirm recursive deletion to remove a non-empty directory.",
            FileError::Running => "Stop this instance before changing its files.",
            FileError::TooLarge => "This operation exceeds the file size or entry limit.",
            FileError::Binary => "Only UTF-8 text files without NUL bytes can be edited.",
            _ => "The file operation could not be completed.",
        };
        Self::new(status, code, detail)
    }
}
