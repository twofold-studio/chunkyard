use crate::ServerManager;
use async_trait::async_trait;
use mcm_core::{
    files::{FileContent, FileError, TEXT_LIMIT, WriteContent},
    properties::*,
    repository::RepositoryError,
    server::*,
};
use mcm_fs::sandbox::Sandbox;
use sha2::{Digest, Sha256};
use std::sync::Arc;
use tokio::sync::OwnedMutexGuard;

pub(crate) type InstanceGuard = Arc<OwnedMutexGuard<()>>;
struct Context {
    server: Server,
    guard: InstanceGuard,
    status: RuntimeStatus,
    identity: Option<String>,
}
impl ServerManager {
    fn configuration_repo(&self) -> Result<&dyn PropertiesRepo, PropertiesError> {
        self.properties_repo.as_deref().ok_or_else(|| {
            PropertiesError::Storage(RepositoryError(
                "properties repository is not configured".into(),
            ))
        })
    }
    async fn configuration_context(
        &self,
        id: &str,
        write: bool,
    ) -> Result<Context, PropertiesError> {
        let server = self.local_record(id).await?;
        let lock = self.lock(&server.id)?;
        let guard = Arc::new(if write {
            lock.try_lock_owned().map_err(|_| ServerError::Busy)?
        } else {
            lock.lock_owned().await
        });
        let server = self.local_record(id).await?;
        let status = match self.runtime.status(&server).await {
            Ok(status) => status,
            Err(ServerError::DockerUnavailable) => RuntimeStatus::unknown(),
            Err(e) => return Err(e.into()),
        };
        let identity = if matches!(status.state, ServerState::Running | ServerState::Paused) {
            self.runtime.configuration_identity(&server).await?
        } else {
            None
        };
        Ok(Context {
            server,
            guard,
            status,
            identity,
        })
    }
    async fn configuration_file(
        &self,
        server: &Server,
        guard: InstanceGuard,
    ) -> Result<FileContent, PropertiesError> {
        let root = self.root.clone();
        let id = server.id.clone();
        tokio::task::spawn_blocking(move || {
            let _guard = guard;
            let fs = Sandbox::open(&root, &id)?;
            match fs.content("server.properties".into(), true) {
                Err(FileError::NotFound) => Ok(FileContent {
                    path: "server.properties".into(),
                    content: String::new(),
                    etag: format!("{:x}", Sha256::digest([])),
                    size: 0,
                    read_only: false,
                    can_write: true,
                }),
                result => result,
            }
        })
        .await
        .map_err(|_| FileError::Io(std::io::Error::other("properties worker failed")))?
        .map_err(Into::into)
    }
    async fn synchronize_configuration(
        &self,
        context: &Context,
    ) -> Result<PropertiesState, PropertiesError> {
        let repo = self.configuration_repo()?;
        let mut state = repo.state(&context.server.id).await?;
        if state.desired.is_none() {
            let file = self
                .configuration_file(&context.server, context.guard.clone())
                .await?;
            repo.append(
                &context.server.id,
                &file.content,
                &file.etag,
                "import",
                None,
                true,
            )
            .await?;
            state = repo.state(&context.server.id).await?;
        } else if let Some(desired) = &state.desired {
            let running = matches!(
                context.status.state,
                ServerState::Running | ServerState::Paused
            );
            let applied = state
                .applied
                .as_ref()
                .filter(|a| context.identity.as_deref() == Some(a.runtime_identity.as_str()));
            let make_desired = state
                .applied
                .as_ref()
                .is_some_and(|a| desired.metadata.etag == a.etag)
                || desired.metadata.source == "import";
            if running && (applied.is_some() || make_desired) {
                let file = self
                    .configuration_file(&context.server, context.guard.clone())
                    .await?;
                let observed_etag = applied
                    .map(|a| a.etag.as_str())
                    .unwrap_or(&desired.metadata.etag);
                if file.etag != observed_etag {
                    // Minecraft fills missing defaults and may persist live console
                    // commands. Record that observed runtime file, retaining any
                    // independently saved desired revision awaiting a restart.
                    let observed = repo
                        .append(
                            &context.server.id,
                            &file.content,
                            &file.etag,
                            "import",
                            Some(&desired.metadata.etag),
                            make_desired,
                        )
                        .await?;
                    if applied.is_some() {
                        repo.set_applied(
                            &context.server.id,
                            Some(observed.metadata.version),
                            context.identity.as_deref(),
                        )
                        .await?;
                    }
                    state = repo.state(&context.server.id).await?;
                }
            }
        }
        Ok(state)
    }
    fn configuration_document(
        context: Context,
        state: PropertiesState,
    ) -> Result<PropertiesDocument, PropertiesError> {
        let desired = state.desired.ok_or(PropertiesError::NotFound)?;
        let running = matches!(
            context.status.state,
            ServerState::Running | ServerState::Paused
        );
        let applied = state.applied.filter(|a| {
            context.status.state == ServerState::Stopped
                || context.identity.as_deref() == Some(a.runtime_identity.as_str())
        });
        Ok(PropertiesDocument {
            restart_required: running
                && applied
                    .as_ref()
                    .is_none_or(|a| a.etag != desired.metadata.etag),
            content: desired.content,
            etag: desired.metadata.etag,
            version: desired.metadata.version,
            applied_version: applied.map(|a| a.version),
            status: context.status,
            updated_at: desired.metadata.created_at,
        })
    }
    pub(crate) async fn prepare_configuration(
        &self,
        server: &Server,
        guard: InstanceGuard,
    ) -> Result<Option<i64>, PropertiesError> {
        if self.properties_repo.is_none() {
            return Ok(None);
        }
        let repo = self.configuration_repo()?;
        let mut state = repo.state(&server.id).await?;
        if state.desired.is_none() {
            let file = self.configuration_file(server, guard.clone()).await?;
            state.desired = Some(
                repo.append(&server.id, &file.content, &file.etag, "import", None, true)
                    .await?,
            );
        }
        let revision = state.desired.ok_or(PropertiesError::NotFound)?;
        // Clear the applied marker BEFORE starting. A crash after Docker start
        // must leave the active version unknown, never falsely claim the old one.
        repo.set_applied(&server.id, None, None).await?;
        let root = self.root.clone();
        let id = server.id.clone();
        let content = revision.content;
        tokio::task::spawn_blocking(move || {
            let _guard = guard;
            let fs = Sandbox::open(&root, &id)?;
            let etag = match fs.content("server.properties".into(), true) {
                Ok(file) => Some(file.etag),
                Err(FileError::NotFound) => None,
                Err(e) => return Err(e),
            };
            fs.save("server.properties".into(), WriteContent { content, etag })
        })
        .await
        .map_err(|_| FileError::Io(std::io::Error::other("properties worker failed")))??;
        Ok(Some(revision.metadata.version))
    }
    pub(crate) async fn mark_configuration_applied(
        &self,
        server: &Server,
        version: Option<i64>,
    ) -> Result<(), PropertiesError> {
        if let Some(version) = version {
            let identity = self.runtime.configuration_identity(server).await?;
            self.configuration_repo()?
                .set_applied(
                    &server.id,
                    identity.as_ref().map(|_| version),
                    identity.as_deref(),
                )
                .await?;
        }
        Ok(())
    }
}
fn validate(content: &str) -> Result<String, PropertiesError> {
    if content.len() as u64 > TEXT_LIMIT {
        return Err(PropertiesError::TooLarge);
    }
    if content.contains('\0') {
        return Err(PropertiesError::Invalid);
    }
    Ok(format!("{:x}", Sha256::digest(content.as_bytes())))
}
#[async_trait]
impl PropertiesService for ServerManager {
    async fn properties(&self, id: &str) -> Result<PropertiesDocument, PropertiesError> {
        let context = self.configuration_context(id, false).await?;
        let state = self.synchronize_configuration(&context).await?;
        Self::configuration_document(context, state)
    }
    async fn save_properties(
        &self,
        id: &str,
        request: PropertiesWrite,
    ) -> Result<PropertiesDocument, PropertiesError> {
        let etag = validate(&request.content)?;
        let context = self.configuration_context(id, true).await?;
        self.synchronize_configuration(&context).await?;
        self.configuration_repo()?
            .append(
                &context.server.id,
                &request.content,
                &etag,
                "edit",
                Some(&request.etag),
                true,
            )
            .await?;
        let state = self.configuration_repo()?.state(&context.server.id).await?;
        Self::configuration_document(context, state)
    }
    async fn properties_history(
        &self,
        id: &str,
        before: Option<i64>,
        limit: u32,
    ) -> Result<PropertiesHistory, PropertiesError> {
        if !(1..=100).contains(&limit) || before.is_some_and(|v| v < 1) {
            return Err(PropertiesError::Invalid);
        }
        let context = self.configuration_context(id, false).await?;
        self.synchronize_configuration(&context).await?;
        let mut items = self
            .configuration_repo()?
            .history(&context.server.id, before, limit + 1)
            .await?;
        let next_before = if items.len() > limit as usize {
            items.truncate(limit as usize);
            items.last().map(|v| v.version)
        } else {
            None
        };
        Ok(PropertiesHistory { items, next_before })
    }
    async fn properties_revision(
        &self,
        id: &str,
        version: i64,
    ) -> Result<PropertiesRevision, PropertiesError> {
        let context = self.configuration_context(id, false).await?;
        self.synchronize_configuration(&context).await?;
        self.configuration_repo()?
            .revision(&context.server.id, version)
            .await
    }
    async fn restore_properties(
        &self,
        id: &str,
        request: PropertiesRestore,
    ) -> Result<PropertiesDocument, PropertiesError> {
        let context = self.configuration_context(id, true).await?;
        self.synchronize_configuration(&context).await?;
        let old = self
            .configuration_repo()?
            .revision(&context.server.id, request.version)
            .await?;
        self.configuration_repo()?
            .append(
                &context.server.id,
                &old.content,
                &old.metadata.etag,
                "restore",
                Some(&request.etag),
                true,
            )
            .await?;
        let state = self.configuration_repo()?.state(&context.server.id).await?;
        Self::configuration_document(context, state)
    }
}

pub(crate) fn file_error(e: PropertiesError) -> FileError {
    match e {
        PropertiesError::Conflict => FileError::Conflict,
        PropertiesError::NotFound => FileError::NotFound,
        PropertiesError::Invalid => FileError::Path,
        PropertiesError::TooLarge => FileError::TooLarge,
        PropertiesError::File(e) => e,
        PropertiesError::Server(e) => FileError::Server(e),
        PropertiesError::Storage(e) => FileError::Server(ServerError::Storage(e)),
    }
}
