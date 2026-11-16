//! Instance admission and publication for verified archive operations.
use super::*;
use crate::{properties::InstanceGuard, transitions::Transition};
use chunkyard_core::exports::ExportError;
use sha2::{Digest, Sha256};

/// Holds instance admission across snapshotting, extraction and publication.
pub(crate) struct ArchiveInstance {
    manager: Arc<ServerManager>,
    id: String,
    guard: InstanceGuard,
}

impl ServerManager {
    pub(crate) async fn archive_instance(
        self: &Arc<Self>,
        id: &str,
        recover: bool,
    ) -> Result<ArchiveInstance, ServerError> {
        let id = Uuid::parse_str(id)
            .map_err(|_| ServerError::NotFound)?
            .to_string();
        let guard = Arc::new(
            self.lock(&id)?
                .try_lock_owned()
                .map_err(|_| ServerError::Busy)?,
        );
        if recover {
            self.recover_pending(&id).await?;
        }
        Ok(ArchiveInstance {
            manager: self.clone(),
            id,
            guard,
        })
    }

    pub(crate) async fn archive_is_pinned(&self, export_id: &str) -> Result<bool, ServerError> {
        Ok(self.repo.list().await?.iter().any(|server| {
            server
                .archive
                .as_ref()
                .is_some_and(|archive| archive.export_id == export_id)
        }))
    }
}

impl ArchiveInstance {
    pub(crate) fn guard(&self) -> InstanceGuard {
        self.guard.clone()
    }

    pub(crate) fn root(&self) -> PathBuf {
        self.manager.root.clone()
    }

    pub(crate) fn token(&self) -> tokio_util::task::task_tracker::TaskTrackerToken {
        self.manager.install_tasks.token()
    }

    pub(crate) async fn record(&self) -> Result<Option<Server>, ServerError> {
        Ok(self.manager.repo.get(&self.id).await?)
    }

    pub(crate) async fn local_record(&self) -> Result<Server, ServerError> {
        self.manager.local_record(&self.id).await
    }

    pub(crate) async fn status(&self, server: &Server) -> Result<RuntimeStatus, ServerError> {
        self.manager.runtime.status(server).await
    }

    pub(crate) async fn remove_runtime(&self, server: &Server) -> Result<(), ServerError> {
        self.manager.runtime.remove(server).await
    }

    pub(crate) async fn desired_properties(&self) -> Result<Option<String>, ExportError> {
        if let Some(repo) = &self.manager.properties_repo {
            Ok(repo
                .state(&self.id)
                .await
                .map_err(|_| ExportError::Storage)?
                .desired
                .map(|revision| revision.content))
        } else {
            Ok(None)
        }
    }

    pub(crate) async fn claim_restore(&self, claimed: &Server) -> Result<(), ExportError> {
        let _creation = self.manager.create_lock.lock().await;
        if self
            .manager
            .repo
            .list()
            .await
            .map_err(ServerError::Storage)?
            .len()
            >= 100
        {
            return Err(ExportError::RestoreConflict);
        }
        self.manager.repo.insert(claimed).await?;
        Ok(())
    }

    /// Track the complete transition so cancellation and shutdown retain its leases.
    pub(crate) async fn publish(
        self: &Arc<Self>,
        server: Server,
        transition: Transition,
        operation: InstanceGuard,
        lease: Arc<dyn Send + Sync>,
        content: Option<String>,
        progress: chunkyard_core::progress::ProgressReporter,
    ) -> Result<(), ExportError> {
        let instance = self.clone();
        self.manager
            .install_tasks
            .spawn(async move {
                let _lease = lease;
                progress.stage(chunkyard_core::progress::Stage::Finalize);
                if let Some(content) = content
                    && let Some(properties) = &instance.manager.properties_repo
                {
                    let state = properties
                        .state(&server.id)
                        .await
                        .map_err(|_| ExportError::Storage)?;
                    let expected = state
                        .desired
                        .as_ref()
                        .map(|revision| revision.metadata.etag.as_str());
                    let etag = format!("{:x}", Sha256::digest(content.as_bytes()));
                    properties
                        .append(&server.id, &content, &etag, "restore", expected, true)
                        .await
                        .map_err(|_| ExportError::Storage)?;
                    properties
                        .set_applied(&server.id, None, None)
                        .await
                        .map_err(|_| ExportError::Storage)?;
                }
                crate::transitions::publish(
                    &instance.manager.root,
                    instance.manager.repo.as_ref(),
                    &server,
                    &transition,
                    operation,
                )
                .await?;
                Ok(())
            })
            .await
            .map_err(|_| ExportError::Storage)?
    }
}
