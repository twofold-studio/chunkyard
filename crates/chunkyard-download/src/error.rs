#[derive(Debug, thiserror::Error)]
pub enum DownloadError {
    #[error("URL is outside the HTTPS host allowlist")]
    ForbiddenUrl,
    #[error("redirect limit exceeded or invalid redirect")]
    Redirect,
    #[error("response exceeds size limit or declared size does not match")]
    Size,
    #[error("artifact checksum mismatch")]
    Checksum,
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error(transparent)]
    Http(#[from] reqwest::Error),
    #[error(transparent)]
    Io(#[from] std::io::Error),
}
