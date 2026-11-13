#[derive(Debug, thiserror::Error)]
pub enum JavaError {
    #[error("another Java installation is in progress")]
    Busy,
    #[error("Java version is missing or invalid")]
    InvalidVersion,
    #[error("no compatible Java asset available for this platform and major")]
    Unavailable,
    #[error("Java runtime probe failed or returned the wrong version")]
    Verify,
    #[error("Java runtime probe timed out")]
    Timeout,
    #[error("invalid or unsupported platform")]
    Platform,
    #[error("installation task failed: {0}")]
    Task(#[from] tokio::task::JoinError),
    #[error(transparent)]
    Download(#[from] mcm_download::DownloadError),
    #[error(transparent)]
    Archive(#[from] mcm_fs::ArchiveError),
    #[error(transparent)]
    Repository(#[from] mcm_core::java::RepositoryError),
    #[error(transparent)]
    Io(#[from] std::io::Error),
}
