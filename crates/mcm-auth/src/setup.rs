use crate::{
    AuthError,
    token::{random_token, token_hash},
};
use std::{
    fs::{self, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
};
use subtle::ConstantTimeEq;

/// The secret is never Debug/Serialize; only its hash remains in memory.
pub struct SetupToken {
    hash: String,
    path: Option<PathBuf>,
}
impl SetupToken {
    /// Creates/loads a private setup token file. The operator reads it locally.
    pub fn load_or_create(path: &Path) -> Result<Self, AuthError> {
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        match options.open(path) {
            Ok(mut file) => {
                file.write_all(random_token().as_bytes())?;
                file.sync_all()?;
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => (),
            Err(error) => return Err(error.into()),
        }
        let metadata = fs::symlink_metadata(path)?;
        if !metadata.is_file() || metadata.len() != 43 {
            return Err(invalid_file());
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if metadata.permissions().mode() & 0o077 != 0 {
                return Err(invalid_file());
            }
        }
        let mut value = String::new();
        fs::File::open(path)?.take(44).read_to_string(&mut value)?;
        if value.len() != 43
            || !value
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
        {
            return Err(invalid_file());
        }
        Ok(Self {
            hash: token_hash(&value),
            path: Some(path.into()),
        })
    }
    pub fn matches(&self, supplied: &str) -> bool {
        let supplied = token_hash(supplied);
        bool::from(self.hash.as_bytes().ct_eq(supplied.as_bytes()))
    }
    pub async fn remove_file(&self) -> Result<(), AuthError> {
        if let Some(path) = &self.path {
            match tokio::fs::remove_file(path).await {
                Ok(()) => (),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
                Err(e) => return Err(e.into()),
            }
        }
        Ok(())
    }
}
fn invalid_file() -> AuthError {
    std::io::Error::new(
        std::io::ErrorKind::PermissionDenied,
        "setup-token must be a private regular file containing a 43-character token",
    )
    .into()
}
