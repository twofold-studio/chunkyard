//! Bounded archive extraction into new, private staging directories.
mod archive;
mod restore;
pub use restore::{extract_instance, inspect_instance};
pub mod sandbox;
pub use archive::{ArchiveFormat, extract, extract_server_pack};
mod error;
pub use error::ArchiveError;
