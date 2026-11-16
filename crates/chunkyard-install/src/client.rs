use chunkyard_core::software::SoftwareError;
use chunkyard_download::SafeHttp;
use serde_json::Value;
use std::path::Path;
use url::Url;

pub struct Installers {
    pub(super) http: SafeHttp,
    pub(super) curseforge_http: SafeHttp,
    pub(super) curseforge_key: Option<String>,
    pub(super) projects:
        tokio::sync::Mutex<std::collections::HashMap<u64, (std::time::Instant, Value)>>,
    pub(super) logos:
        tokio::sync::Mutex<std::collections::HashMap<u64, (std::time::Instant, Vec<u8>)>>,
    pub(super) logo_http: SafeHttp,
    pub(super) logo_slots: tokio::sync::Semaphore,
    pub(super) progress: chunkyard_core::progress::ProgressReporter,
}
impl Installers {
    pub fn new() -> Result<Self, chunkyard_download::DownloadError> {
        Ok(Self {
            http: SafeHttp::minecraft()?,
            curseforge_http: SafeHttp::modpacks()?,
            curseforge_key: None,
            projects: Default::default(),
            logos: Default::default(),
            logo_http: SafeHttp::logos()?,
            logo_slots: tokio::sync::Semaphore::new(4),
            progress: Default::default(),
        })
    }
    pub fn with_curseforge(mut self, key: Option<String>) -> Self {
        self.curseforge_key = key;
        self
    }
    pub(super) fn reporting(&self, progress: chunkyard_core::progress::ProgressReporter) -> Self {
        let report = progress.clone();
        let callback = std::sync::Arc::new(move |event| {
            use chunkyard_core::progress::Stage;
            match event {
                chunkyard_download::ArtifactProgress::Bytes { completed, total } => {
                    report.bytes(Stage::Download, Some(completed), Some(total))
                }
                chunkyard_download::ArtifactProgress::Verify => report.stage(Stage::Verify),
            }
        });
        Self {
            http: self.http.clone().with_progress(callback.clone()),
            curseforge_http: self.curseforge_http.clone().with_progress(callback),
            curseforge_key: self.curseforge_key.clone(),
            logo_http: self.logo_http.clone(),
            logo_slots: tokio::sync::Semaphore::new(4),
            projects: Default::default(),
            logos: Default::default(),
            progress,
        }
    }
    pub(super) async fn json(&self, url: &str) -> Result<Value, SoftwareError> {
        tokio::time::timeout(
            std::time::Duration::from_secs(30),
            self.http
                .json(Url::parse(url).map_err(|_| SoftwareError::Invalid)?),
        )
        .await
        .map_err(|_| SoftwareError::Upstream)?
        .map_err(|_| SoftwareError::Upstream)
    }
    pub(super) async fn artifact(
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
pub(super) fn string<'a>(value: &'a Value, name: &str) -> Result<&'a str, SoftwareError> {
    value[name].as_str().ok_or(SoftwareError::Upstream)
}
