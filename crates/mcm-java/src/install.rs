use crate::{
    AdoptiumApi, DiscoveryPaths, JavaError, identify,
    platform::{host_arch, host_os, java_name},
};
use fs2::FileExt;
use mcm_core::java::{JavaRuntime, JavaRuntimeRepo};
use mcm_download::SafeHttp;
use mcm_fs::ArchiveFormat;
use std::{
    path::{Path, PathBuf},
    sync::Arc,
};

/// Owns runtime operations, with repository and upstream API injected by the binary.
pub struct JavaManager {
    root: PathBuf,
    repo: Arc<dyn JavaRuntimeRepo>,
    upstream: Arc<dyn AdoptiumApi>,
    http: SafeHttp,
}

impl JavaManager {
    pub fn new(
        root: PathBuf,
        repo: Arc<dyn JavaRuntimeRepo>,
        upstream: Arc<dyn AdoptiumApi>,
        http: SafeHttp,
    ) -> Self {
        Self {
            root,
            repo,
            upstream,
            http,
        }
    }
    pub async fn releases(&self) -> Result<crate::Releases, JavaError> {
        self.upstream.releases().await
    }

    pub async fn list(&self) -> Result<Vec<JavaRuntime>, JavaError> {
        Ok(self.repo.list().await?)
    }

    pub async fn discover(&self, paths: DiscoveryPaths) -> Result<Vec<JavaRuntime>, JavaError> {
        let runtimes = crate::discover(paths, &self.root).await?;
        self.repo.replace_system(&runtimes).await?;
        self.list().await
    }

    /// Installs side by side; never modifies a system JRE or replaces a pinned version.
    /// A nonblocking per-major OS file lock prevents concurrent CLI/daemon installs, including
    /// across processes, and is released automatically after a crash.
    pub async fn install(&self, major: u16) -> Result<JavaRuntime, JavaError> {
        if major == 0 {
            return Err(JavaError::InvalidVersion);
        }
        tokio::fs::create_dir_all(&self.root).await?;
        let root = tokio::fs::canonicalize(&self.root).await?;
        let lock = std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(root.join(format!(".install-{major}.lock")))?;
        lock.try_lock_exclusive().map_err(|_| JavaError::Busy)?;
        let asset = self.upstream.latest(major).await?;
        if asset.major != major || asset.version.is_empty() {
            return Err(JavaError::Verify);
        }
        // Content-derived directory names avoid trusting upstream version strings as paths.
        if asset.checksum.len() != 64 || !asset.checksum.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err(JavaError::Verify);
        }
        let destination = root.join(format!(
            "temurin-{major}-{}-{}-{}",
            host_os()?,
            host_arch()?,
            asset.checksum.to_ascii_lowercase()
        ));
        if let Some(runtime) = self
            .repo
            .list()
            .await?
            .into_iter()
            .find(|r| r.managed && r.path.starts_with(&destination) && r.path.is_file())
        {
            return Ok(runtime);
        }
        if !destination.exists() {
            let staging = Arc::new(
                tempfile::Builder::new()
                    .prefix(".install-")
                    .tempdir_in(&root)?,
            );
            let archive_path = staging.path().join("archive");
            self.http
                .download(asset.url, &archive_path, asset.size, &asset.checksum)
                .await?;
            let unpacked = staging.path().join("unpacked");
            let unpacked_for_task = unpacked.clone();
            let format = if asset.zip {
                ArchiveFormat::Zip
            } else {
                ArchiveFormat::TarGz
            };
            // Keep the staging directory alive if the caller cancels while the
            // blocking extractor is still running.
            let staging_guard = staging.clone();
            tokio::task::spawn_blocking(move || {
                let _guard = staging_guard;
                mcm_fs::extract(&archive_path, &unpacked_for_task, format)
            })
            .await??;
            let home = single_root(&unpacked).await?;
            let runtime = identify(&home.join("bin").join(java_name())).await?;
            if runtime.major != major {
                return Err(JavaError::Verify);
            }
            tokio::fs::rename(home, &destination).await?;
        }
        // Also recovers a completed install if the process stopped before the DB commit.
        let mut runtime = identify(&destination.join("bin").join(java_name())).await?;
        if runtime.major != major {
            return Err(JavaError::Verify);
        }
        runtime.managed = true;
        runtime.sha256 = Some(asset.checksum);
        self.repo.upsert(&runtime).await?;
        // Return the persisted identity, including when a path already existed in storage.
        self.repo
            .list()
            .await?
            .into_iter()
            .find(|r| r.path == runtime.path)
            .ok_or(JavaError::Verify)
    }
}

async fn single_root(unpacked: &Path) -> Result<PathBuf, JavaError> {
    let mut entries = tokio::fs::read_dir(unpacked).await?;
    let entry = entries.next_entry().await?.ok_or(JavaError::Verify)?;
    if !entry.file_type().await?.is_dir() || entries.next_entry().await?.is_some() {
        return Err(JavaError::Verify);
    }
    Ok(entry.path())
}
