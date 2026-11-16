//! Restricted outbound HTTPS and streaming, checksum-verified downloads.
mod client;
mod icon;
mod resolver;
pub use client::{ArtifactProgress, SafeHttp};
pub use icon::{IconDecodeError, decode_icon, normalize_icon};
mod error;
pub use error::DownloadError;
