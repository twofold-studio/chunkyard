use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use uuid::Uuid;

/// Stable identity; paths and versions can change independently of a server pin.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct JavaRuntimeId(pub Uuid);

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct JavaRuntime {
    pub id: JavaRuntimeId,
    pub vendor: String,
    pub major: u16,
    pub full_version: String,
    pub os: String,
    pub arch: String,
    pub path: PathBuf,
    pub managed: bool,
    pub sha256: Option<String>,
}

#[derive(Debug, Clone, Copy)]
pub struct JavaRequirement {
    pub major: u16,
    /// Older mod loaders may require an exact Java major.
    pub strict: bool,
}

pub use crate::repository::RepositoryError;

/// Implemented only by the persistence crate (or test fakes).
#[async_trait]
pub trait JavaRuntimeRepo: Send + Sync {
    async fn list(&self) -> Result<Vec<JavaRuntime>, RepositoryError>;
    async fn upsert(&self, runtime: &JavaRuntime) -> Result<(), RepositoryError>;
    /// Atomically refresh system runtimes; preserve IDs for unchanged paths.
    async fn replace_system(&self, runtimes: &[JavaRuntime]) -> Result<(), RepositoryError>;
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AvailableJava {
    pub lts: Vec<u16>,
    pub all: Vec<u16>,
    pub most_recent_lts: u16,
}

#[derive(Debug, thiserror::Error)]
#[error("{detail}")]
pub struct JavaServiceError {
    pub code: &'static str,
    pub detail: &'static str,
}

/// Boundary consumed by HTTP handlers and jobs; implemented by the Java crate.
#[async_trait]
pub trait JavaRuntimeService: Send + Sync {
    async fn list(&self) -> Result<Vec<JavaRuntime>, JavaServiceError>;
    async fn discover(&self) -> Result<Vec<JavaRuntime>, JavaServiceError>;
    async fn available(&self) -> Result<AvailableJava, JavaServiceError>;
    async fn install(&self, major: u16) -> Result<JavaRuntime, JavaServiceError>;
}
