//! SQLite repository implementations. All repositories share one database pool.
mod auth;
mod database;
mod jobs;
mod operations;
pub use auth::SqliteAuthRepo;
pub use database::{Database, DatabaseError};
pub use jobs::SqliteJobRepo;
pub use operations::SqliteOperationsRepo;
pub(crate) fn storage(error: impl std::fmt::Display) -> mcm_core::repository::RepositoryError {
    mcm_core::repository::RepositoryError(error.to_string())
}
mod properties;
mod servers;
pub use properties::SqlitePropertiesRepo;
pub use servers::SqliteServerRepo;
