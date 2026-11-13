#![cfg(unix)]
use async_trait::async_trait;
use fs2::FileExt;
use mcm_core::java::{JavaRuntime, JavaRuntimeRepo, RepositoryError};
use mcm_download::SafeHttp;
use mcm_java::{AdoptiumApi, JavaAsset, JavaError, JavaManager, Releases};
use std::{
    error::Error,
    fs,
    os::unix::fs::PermissionsExt,
    sync::{Arc, Mutex},
};

#[derive(Default)]
struct MemoryRepo(Mutex<Vec<JavaRuntime>>);
#[async_trait]
impl JavaRuntimeRepo for MemoryRepo {
    async fn list(&self) -> Result<Vec<JavaRuntime>, RepositoryError> {
        Ok(self
            .0
            .lock()
            .map_err(|e| RepositoryError(e.to_string()))?
            .clone())
    }
    async fn upsert(&self, runtime: &JavaRuntime) -> Result<(), RepositoryError> {
        self.0
            .lock()
            .map_err(|e| RepositoryError(e.to_string()))?
            .push(runtime.clone());
        Ok(())
    }
    async fn replace_system(&self, _: &[JavaRuntime]) -> Result<(), RepositoryError> {
        Ok(())
    }
}
struct Upstream(JavaAsset);
#[async_trait]
impl AdoptiumApi for Upstream {
    async fn releases(&self) -> Result<Releases, JavaError> {
        Err(JavaError::Unavailable)
    }
    async fn latest(&self, _: u16) -> Result<JavaAsset, JavaError> {
        Ok(self.0.clone())
    }
}
fn asset() -> Result<JavaAsset, Box<dyn Error>> {
    Ok(JavaAsset {
        version: "21.0.10".into(),
        major: 21,
        url: "https://api.adoptium.net/unused".parse()?,
        checksum: "a".repeat(64),
        size: 1,
        zip: false,
    })
}

#[tokio::test]
async fn recovers_after_rename_and_reuses_the_persisted_identity() -> Result<(), Box<dyn Error>> {
    let dir = tempfile::tempdir()?;
    let root = dir.path().join("runtimes");
    let os = if std::path::Path::new("/etc/alpine-release").exists() {
        "alpine-linux"
    } else {
        "linux"
    };
    let arch = if cfg!(target_arch = "aarch64") {
        "aarch64"
    } else {
        "x64"
    };
    let home = root.join(format!("temurin-21-{os}-{arch}-{}", "a".repeat(64)));
    fs::create_dir_all(home.join("bin"))?;
    let path = home.join("bin/java");
    fs::write(
        &path,
        "#!/bin/sh\nprintf 'openjdk version \"21.0.10\"\\n' >&2\n",
    )?;
    fs::set_permissions(&path, fs::Permissions::from_mode(0o755))?;
    let repo = Arc::new(MemoryRepo::default());
    let manager = JavaManager::new(
        root,
        repo.clone(),
        Arc::new(Upstream(asset()?)),
        SafeHttp::adoptium()?,
    );
    let recovered = manager.install(21).await?;
    let repeated = manager.install(21).await?;
    assert_eq!(repeated.id, recovered.id);
    assert!(recovered.managed);
    assert_eq!(repo.list().await?.len(), 1);
    Ok(())
}

#[tokio::test]
async fn same_major_install_lock_excludes_a_second_installer() -> Result<(), Box<dyn Error>> {
    let dir = tempfile::tempdir()?;
    let lock = fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(dir.path().join(".install-21.lock"))?;
    lock.try_lock_exclusive()?;
    let manager = JavaManager::new(
        dir.path().to_path_buf(),
        Arc::new(MemoryRepo::default()),
        Arc::new(Upstream(asset()?)),
        SafeHttp::adoptium()?,
    );
    assert!(matches!(manager.install(21).await, Err(JavaError::Busy)));
    Ok(())
}

#[tokio::test]
async fn rejects_upstream_major_mismatch_before_downloading() -> Result<(), Box<dyn Error>> {
    let dir = tempfile::tempdir()?;
    let manager = JavaManager::new(
        dir.path().to_path_buf(),
        Arc::new(MemoryRepo::default()),
        Arc::new(Upstream(asset()?)),
        SafeHttp::adoptium()?,
    );
    assert!(matches!(manager.install(8).await, Err(JavaError::Verify)));
    assert!(manager.list().await?.is_empty());
    Ok(())
}
