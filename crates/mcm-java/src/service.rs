use crate::{DiscoveryPaths, JavaError, JavaManager};
use async_trait::async_trait;
use mcm_core::java::{AvailableJava, JavaRuntime, JavaRuntimeService, JavaServiceError};
impl From<JavaError> for JavaServiceError {
    fn from(error: JavaError) -> Self {
        let (code, detail) = match error {
            JavaError::Busy => (
                "java.installing",
                "Another Java installation for this major is running.",
            ),
            JavaError::InvalidVersion => {
                ("validation", "A positive Java major version is required.")
            }
            JavaError::Unavailable | JavaError::Platform => (
                "java.unavailable",
                "No Java runtime is available for this version and platform.",
            ),
            JavaError::Verify | JavaError::Timeout => (
                "java.verify_failed",
                "The Java executable did not pass verification.",
            ),
            JavaError::Download(mcm_download::DownloadError::Checksum) => (
                "download.hash_mismatch",
                "The downloaded archive failed its integrity check.",
            ),
            JavaError::Download(_) => ("download.failed", "The Java provider request failed."),
            _ => ("internal", "The Java operation could not be completed."),
        };
        tracing::warn!(code, "Java operation failed");
        Self { code, detail }
    }
}
#[async_trait]
impl JavaRuntimeService for JavaManager {
    async fn list(&self) -> Result<Vec<JavaRuntime>, JavaServiceError> {
        Ok(JavaManager::list(self).await?)
    }
    async fn discover(&self) -> Result<Vec<JavaRuntime>, JavaServiceError> {
        Ok(JavaManager::discover(self, DiscoveryPaths::system()).await?)
    }
    async fn available(&self) -> Result<AvailableJava, JavaServiceError> {
        let releases = self.releases().await?;
        Ok(AvailableJava {
            lts: releases.available_lts_releases,
            all: releases.available_releases,
            most_recent_lts: releases.most_recent_lts,
        })
    }
    async fn install(&self, major: u16) -> Result<JavaRuntime, JavaServiceError> {
        Ok(JavaManager::install(self, major).await?)
    }
}
