//! Shared persistence error boundary.
#[derive(Debug, thiserror::Error)]
#[error("storage operation failed: {0}")]
pub struct RepositoryError(pub String);
