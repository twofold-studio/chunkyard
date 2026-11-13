//! Java discovery and managed installation, independent of HTTP handlers and SQLite.
mod adoptium;
mod discovery;
mod error;
mod install;
mod platform;
mod probe;
mod selection;
mod version;
pub use adoptium::{Adoptium, AdoptiumApi, JavaAsset, Releases};
pub use discovery::{DiscoveryPaths, discover};
pub use error::JavaError;
pub use install::JavaManager;
pub use probe::identify;
pub use selection::select;
pub use version::major_version;

mod service;
