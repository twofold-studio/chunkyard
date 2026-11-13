//! Official Vanilla and Paper metadata with bounded, checksum-verified downloads.
mod providers;
use mcm_core::software::SoftwareError;
use mcm_download::SafeHttp;
use serde_json::Value;
use std::path::Path;
use url::Url;

pub struct Installers {
    http: SafeHttp,
}
impl Installers {
    pub fn new() -> Result<Self, mcm_download::DownloadError> {
        Ok(Self {
            http: SafeHttp::minecraft()?,
        })
    }
    async fn json(&self, url: &str) -> Result<Value, SoftwareError> {
        tokio::time::timeout(
            std::time::Duration::from_secs(30),
            self.http
                .json(Url::parse(url).map_err(|_| SoftwareError::Invalid)?),
        )
        .await
        .map_err(|_| SoftwareError::Upstream)?
        .map_err(|_| SoftwareError::Upstream)
    }
    async fn artifact(
        &self,
        url: &str,
        path: &Path,
        size: u64,
        checksum: &str,
    ) -> Result<(), SoftwareError> {
        self.http
            .artifact(
                Url::parse(url).map_err(|_| SoftwareError::Upstream)?,
                path,
                size,
                checksum,
            )
            .await
            .map_err(|_| SoftwareError::Download)
    }
}
fn string<'a>(value: &'a Value, name: &str) -> Result<&'a str, SoftwareError> {
    value[name].as_str().ok_or(SoftwareError::Upstream)
}
