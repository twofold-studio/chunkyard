use crate::common;
use async_trait::async_trait;
use chunkyard_core::{server::*, software::*};
use std::sync::{Arc, Condvar, Mutex};
struct Blocked {
    started: Arc<tokio::sync::Notify>,
    release: Arc<(Mutex<bool>, Condvar)>,
}
#[async_trait]
impl SoftwareService for Blocked {
    fn catalog(&self) -> serde_json::Value {
        serde_json::json!({"items":[]})
    }
    async fn versions(&self, _: &str) -> Result<serde_json::Value, SoftwareError> {
        Err(SoftwareError::Invalid)
    }
    async fn builds(&self, _: &str, _: &str) -> Result<serde_json::Value, SoftwareError> {
        Err(SoftwareError::Invalid)
    }
    async fn prepare(&self, _: &Software, _: &std::path::Path) -> Result<Launch, SoftwareError> {
        Err(SoftwareError::Invalid)
    }
    async fn prepare_plan(
        &self,
        _: &Software,
        _: &std::path::Path,
        _: &InstallOptions,
        lease: Arc<dyn Send + Sync>,
    ) -> Result<PreparedSoftware, SoftwareError> {
        let started = self.started.clone();
        let release = self.release.clone();
        tokio::task::spawn_blocking(move || {
            let _lease = lease;
            started.notify_one();
            let (mutex, signal) = &*release;
            let ready = mutex.lock().map_err(|_| SoftwareError::Filesystem)?;
            let _ready = signal
                .wait_while(ready, |ready| !*ready)
                .map_err(|_| SoftwareError::Filesystem)?;
            Err(SoftwareError::PackUnsupported)
        })
        .await
        .map_err(|_| SoftwareError::Filesystem)?
    }
}
#[tokio::test]
async fn cancelled_install_retains_instance_lock_and_staging_until_blocking_work_finishes()
-> Result<(), Box<dyn std::error::Error>> {
    let dir = tempfile::tempdir()?;
    let database = chunkyard_db::Database::open(&dir.path().join("test.db")).await?;
    let started = Arc::new(tokio::sync::Notify::new());
    let release = Arc::new((Mutex::new(false), Condvar::new()));
    let manager = Arc::new(
        chunkyard_process::ServerManager::new(
            dir.path().join("servers"),
            "fixture".into(),
            Arc::new(chunkyard_db::SqliteServerRepo::new(&database)),
            Arc::new(common::runtime::FakeRuntime::default()),
        )
        .with_installers(Arc::new(Blocked {
            started: started.clone(),
            release: release.clone(),
        })),
    );
    let instance=manager.create(serde_json::from_value(serde_json::json!({"name":"Cancellation fixture","software":{"type":"curseforge","projectId":1,"fileId":2}}))?).await?;
    let worker = manager.clone();
    let id = instance.server.id.clone();
    let task = tokio::spawn(async move { worker.install(&id).await });
    tokio::time::timeout(std::time::Duration::from_secs(5), started.notified()).await?;
    task.abort();
    let _ = task.await;
    assert!(matches!(
        manager.delete(&instance.server.id, true).await,
        Err(ServerError::Busy)
    ));
    {
        let (lock, signal) = &*release;
        *lock.lock().map_err(|_| "poisoned")? = true;
        signal.notify_all();
    }
    tokio::time::timeout(std::time::Duration::from_secs(5), manager.shutdown()).await?;
    manager.delete(&instance.server.id, true).await?;
    assert!(!instance.directory.exists());
    database.close().await;
    Ok(())
}
