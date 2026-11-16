use crate::common;
use async_trait::async_trait;
use chunkyard_core::{
    repository::RepositoryError,
    server::*,
    software::{Launch, LaunchProfile},
};
use std::sync::Arc;
struct LostAck {
    repo: Arc<chunkyard_db::SqliteServerRepo>,
    committed: Arc<tokio::sync::Notify>,
}
#[async_trait]
impl ServerRepo for LostAck {
    async fn save(&self, server: &Server) -> Result<(), RepositoryError> {
        self.repo.save(server).await
    }
    async fn set_launch(
        &self,
        id: &str,
        p: Option<&LaunchProfile>,
        image: &str,
        auto: bool,
    ) -> Result<(), RepositoryError> {
        self.repo.set_launch(id, p, image, auto).await
    }
    async fn set_resources(&self, id: &str, r: &ResourceUpdate) -> Result<(), RepositoryError> {
        self.repo.set_resources(id, r).await
    }
    async fn set_network(
        &self,
        id: &str,
        port: u16,
        ip: Option<std::net::IpAddr>,
    ) -> Result<(), RepositoryError> {
        self.repo.set_network(id, port, ip).await
    }
    async fn delete(&self, id: &str) -> Result<(), RepositoryError> {
        self.repo.delete(id).await
    }
    async fn insert(&self, s: &Server) -> Result<(), ServerError> {
        self.repo.insert(s).await
    }
    async fn set_eula(&self, id: &str, accepted: bool) -> Result<(), RepositoryError> {
        self.repo.set_eula(id, accepted).await
    }
    async fn get(&self, id: &str) -> Result<Option<Server>, RepositoryError> {
        self.repo.get(id).await
    }
    async fn list(&self) -> Result<Vec<Server>, RepositoryError> {
        self.repo.list().await
    }
    async fn set_installation(
        &self,
        id: &str,
        l: &Launch,
        image: &str,
    ) -> Result<(), RepositoryError> {
        self.repo.set_installation(id, l, image).await?;
        self.committed.notify_one();
        std::future::pending().await
    }
}
#[tokio::test]
async fn cancellation_after_database_commit_never_removes_published_pack_files()
-> Result<(), Box<dyn std::error::Error>> {
    let dir = tempfile::tempdir()?;
    let database = chunkyard_db::Database::open(&dir.path().join("test.db")).await?;
    let repo = Arc::new(chunkyard_db::SqliteServerRepo::new(&database));
    let committed = Arc::new(tokio::sync::Notify::new());
    let manager = Arc::new(
        chunkyard_process::ServerManager::new(
            dir.path().join("servers"),
            "fixture".into(),
            Arc::new(LostAck {
                repo: repo.clone(),
                committed: committed.clone(),
            }),
            Arc::new(common::runtime::FakeRuntime::default()),
        )
        .with_installers(Arc::new(common::software::FakeSoftware::default())),
    );
    let instance=manager.create(serde_json::from_value(serde_json::json!({"name":"Lost acknowledgement fixture","software":{"type":"curseforge","projectId":1,"fileId":2}}))?).await?;
    let worker = manager.clone();
    let id = instance.server.id.clone();
    let task = tokio::spawn(async move { worker.install(&id).await });
    tokio::time::timeout(std::time::Duration::from_secs(5), committed.notified()).await?;
    task.abort();
    let _ = task.await;
    manager.shutdown().await;
    let saved = repo.get(&instance.server.id).await?.ok_or("server")?;
    let launch = saved.launch.ok_or("launch")?;
    assert!(instance.directory.join(launch.path).is_file());
    assert!(instance.directory.join("mods/mod.jar").is_file());
    manager.delete(&instance.server.id, true).await?;
    database.close().await;
    Ok(())
}
