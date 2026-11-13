//! Password/session authentication with persistent repository boundaries.
mod password;
mod service;
mod setup;
mod throttle;
mod token;
pub use service::{AuthService, IssuedSession};
pub use setup::SetupToken;
pub use token::{token_hash, unix_time};

#[derive(Debug, thiserror::Error)]
pub enum AuthError {
    #[error("invalid credentials")]
    InvalidCredentials,
    #[error("authentication is required")]
    Required,
    #[error("initial setup is required")]
    SetupRequired,
    #[error("setup is already complete")]
    AlreadySetup,
    #[error("invalid setup token")]
    InvalidSetupToken,
    #[error("a valid email address of at most 254 bytes is required")]
    Email,
    #[error("password must be 10–256 characters and not a common password")]
    Password,
    #[error("too many authentication attempts; try again later")]
    Throttled,
    #[error("authentication worker failed")]
    Worker,
    #[error("invalid stored password hash")]
    Hash,
    #[error(transparent)]
    Storage(#[from] mcm_core::repository::RepositoryError),
    #[error(transparent)]
    Io(#[from] std::io::Error),
}
