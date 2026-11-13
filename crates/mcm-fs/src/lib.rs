//! Bounded archive extraction into new, private staging directories.
mod archive;
pub use archive::{ArchiveFormat, extract};

#[derive(Debug, thiserror::Error)]
pub enum ArchiveError {
    #[error("archive contains an unsafe path, link, or unsupported entry")]
    UnsafeEntry,
    #[error("archive exceeds extraction limits")]
    Limit,
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Zip(#[from] zip::result::ZipError),
}
