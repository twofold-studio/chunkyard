use super::*;
use crate::transitions::{Transition, TransitionKind};
use mcm_core::{
    progress::{ProgressReporter, Stage},
    server::{ArchiveReference, Server, ServerError, ServerView},
};
use tokio::io::AsyncWriteExt;

struct Lease {
    _operation: Arc<tokio::sync::OwnedMutexGuard<()>>,
    _instance: Arc<tokio::sync::OwnedMutexGuard<()>>,
    _staging: Option<tempfile::TempDir>,
    _token: tokio_util::task::task_tracker::TaskTrackerToken,
}
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct Manifest {
    format_version: u32,
    server: Server,
}
async fn write_restored(path: PathBuf, bytes: &[u8]) -> Result<(), ExportError> {
    let mut file = tokio::fs::File::create(path).await?;
    file.write_all(bytes).await?;
    file.sync_all().await?;
    Ok(())
}

fn full_backup(record: &Export) -> Result<(), ExportError> {
    if record.scope != ExportScope::All
        || record.size == 0
        || record.size > 5 * 1024 * 1024 * 1024
        || record.sha256.len() != 64
        || !record.sha256.bytes().all(|b| b.is_ascii_hexdigit())
        || record.file_name != format!("chunkyard-{}.tar.gz", record.id)
    {
        return Err(ExportError::InvalidArchive);
    }
    Ok(())
}
fn manifest(bytes: &[u8], id: &str) -> Result<Server, ExportError> {
    let manifest: Manifest =
        serde_json::from_slice(bytes).map_err(|_| ExportError::InvalidArchive)?;
    let server = manifest.server;
    if manifest.format_version != 1
        || server.id != id
        || Uuid::parse_str(id).is_err()
        || server.archive.is_some()
    {
        return Err(ExportError::InvalidArchive);
    }
    crate::validation::validate(&mcm_core::server::CreateServer {
        runtime: server.runtime.clone(),
        name: server.name.clone(),
        port: Some(server.port),
        jar: "server.jar".into(),
        docker_image: Some(server.docker_image.clone()),
        memory_min_mb: server.memory_min_mb,
        memory_max_mb: server.memory_max_mb,
        cpus: server.cpus,
        accept_eula: false,
        software: server.software.clone(),
    })
    .map_err(|_| ExportError::InvalidArchive)?;
    if let Some(software) = &server.software {
        software
            .validate()
            .map_err(|_| ExportError::InvalidArchive)?;
    }
    if server.software.is_some() || server.launch_override.is_some() {
        crate::launch::current(&server)
            .validate()
            .map_err(|_| ExportError::InvalidArchive)?;
    } else {
        crate::validation::jar_path(&server.jar).map_err(|_| ExportError::InvalidArchive)?;
    }
    Ok(server)
}

impl ExportManager {
    async fn verified_archive(
        &self,
        record: &Export,
        progress: &ProgressReporter,
    ) -> Result<tempfile::NamedTempFile, ExportError> {
        full_backup(record)?;
        let temporary = tempfile::Builder::new()
            .prefix(".export-")
            .tempfile_in(&self.root)?;
        let mut output = tokio::fs::File::from_std(temporary.reopen()?);
        let mut source = self.download(&record.id).await?;
        if source.size != record.size {
            return Err(ExportError::InvalidArchive);
        }
        let mut bytes = 0;
        let mut hash = Sha256::new();
        progress.bytes(Stage::FetchArchive, Some(0), Some(record.size));
        while let Some(chunk) = source.stream.next().await {
            let chunk = chunk?;
            bytes += chunk.len() as u64;
            if bytes > record.size {
                return Err(ExportError::InvalidArchive);
            }
            hash.update(&chunk);
            output.write_all(&chunk).await?;
            progress.bytes(Stage::FetchArchive, Some(bytes), Some(record.size));
        }
        output.sync_all().await?;
        progress.stage(Stage::VerifyArchive);
        if bytes != record.size
            || format!("{:x}", hash.finalize()) != record.sha256.to_ascii_lowercase()
        {
            return Err(ExportError::InvalidArchive);
        }
        Ok(temporary)
    }

    pub(super) async fn archive_local(
        &self,
        id: &str,
        request: ArchiveRequest,
        progress: ProgressReporter,
    ) -> Result<ServerView, ExportError> {
        if !request.confirm_discard_changes {
            return Err(ExportError::BackupRequired);
        }
        let export_id = Uuid::parse_str(&request.export_id)
            .map_err(|_| ExportError::Invalid)?
            .to_string();
        let operation = Arc::new(
            self.operation
                .clone()
                .try_lock_owned()
                .map_err(|_| ExportError::Busy)?,
        );
        let server = self.servers.record(id).await?;
        let instance = Arc::new(
            self.servers
                .lock(&server.id)?
                .try_lock_owned()
                .map_err(|_| ServerError::Busy)?,
        );
        self.servers.recover_pending(&server.id).await?;
        let mut server = self.servers.record(&server.id).await?;
        if let Some(archive) = &server.archive {
            if archive.export_id == export_id {
                return Ok(self.servers.view(server).await?);
            }
            return Err(ExportError::BackupRequired);
        }
        let record = self.record(&export_id).await?;
        full_backup(&record)?;
        if record.server_id != server.id || record.destination != ExportDestination::S3 {
            return Err(ExportError::BackupRequired);
        }
        if self.servers.runtime.status(&server).await?.state != ServerState::Stopped {
            return Err(ServerError::AlreadyRunning.into());
        }
        let lease = Arc::new(Lease {
            _operation: operation.clone(),
            _instance: instance,
            _staging: None,
            _token: self.servers.install_tasks.token(),
        });
        let archive = self.verified_archive(&record, &progress).await?;
        let worker = lease.clone();
        let worker_progress = progress.clone();
        let bytes = tokio::task::spawn_blocking(move || {
            let _lease = worker;
            mcm_fs::inspect_instance(archive.path(), worker_progress)
        })
        .await
        .map_err(|_| ExportError::InvalidArchive)?
        .map_err(|_| ExportError::InvalidArchive)?;
        manifest(&bytes, &server.id)?;
        self.servers.runtime.remove(&server).await?;
        server.archive = Some(ArchiveReference {
            export_id: record.id,
            archived_at: timestamp(),
        });
        let transition = Transition {
            id: server.id.clone(),
            kind: TransitionKind::Archive,
            staging: format!(".chunkyard-archive-{}", server.id),
            previous: None,
            next: server.archive.clone(),
        };
        let servers = self.servers.clone();
        let published = server.clone();
        // A caller cancellation cannot cut a directory/metadata transition in half.
        self.servers
            .install_tasks
            .spawn(async move {
                let _lease = lease;
                progress.stage(Stage::Finalize);
                crate::transitions::publish(
                    &servers.root,
                    servers.repo.as_ref(),
                    &published,
                    &transition,
                    operation,
                )
                .await
            })
            .await
            .map_err(|_| ExportError::Storage)??;
        Ok(self.servers.view(server).await?)
    }

    pub(super) async fn restore_archive(
        &self,
        id: &str,
        progress: ProgressReporter,
    ) -> Result<ServerView, ExportError> {
        let operation = Arc::new(
            self.operation
                .clone()
                .try_lock_owned()
                .map_err(|_| ExportError::Busy)?,
        );
        let record = self.record(id).await?;
        full_backup(&record)?;
        Uuid::parse_str(&record.server_id).map_err(|_| ExportError::InvalidArchive)?;
        let instance = Arc::new(
            self.servers
                .lock(&record.server_id)?
                .try_lock_owned()
                .map_err(|_| ServerError::Busy)?,
        );
        self.servers.recover_pending(&record.server_id).await?;
        let existing = self
            .servers
            .repo
            .get(&record.server_id)
            .await
            .map_err(ServerError::Storage)?;
        if existing.as_ref().is_some_and(|s| s.archive.is_none())
            || tokio::fs::symlink_metadata(self.servers.root.join(&record.server_id))
                .await
                .is_ok()
        {
            return Err(ExportError::RestoreConflict);
        }
        tokio::fs::create_dir_all(&self.servers.root).await?;
        let staging = tempfile::Builder::new()
            .prefix(".chunkyard-restore-")
            .tempdir_in(&self.servers.root)?;
        let staging_path = staging.path().to_owned();
        let staging_name = staging_path
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or(ExportError::Storage)?
            .to_owned();
        let lease = Arc::new(Lease {
            _operation: operation.clone(),
            _instance: instance,
            _staging: Some(staging),
            _token: self.servers.install_tasks.token(),
        });
        let archive = self.verified_archive(&record, &progress).await?;
        let files = staging_path.join("files");
        let extract = files.clone();
        let worker = lease.clone();
        let worker_progress = progress.clone();
        let bytes = tokio::task::spawn_blocking(move || {
            let _lease = worker;
            mcm_fs::extract_instance(archive.path(), &extract, worker_progress)
        })
        .await
        .map_err(|_| ExportError::InvalidArchive)?
        .map_err(|_| ExportError::InvalidArchive)?;
        let snapshot = manifest(&bytes, &record.server_id)?;
        // Restore configuration as a new desired revision, retaining older history.
        let content = match tokio::fs::read(files.join("server.properties")).await {
            Ok(bytes) if bytes.len() <= 1024 * 1024 && !bytes.contains(&0) => {
                String::from_utf8(bytes).map_err(|_| ExportError::InvalidArchive)?
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                "server-port=25565\nenable-rcon=false\n".into()
            }
            _ => return Err(ExportError::InvalidArchive),
        };
        let mut server = if let Some(existing) = existing {
            existing
        } else {
            let _creation = self.servers.create_lock.lock().await;
            if self
                .servers
                .repo
                .list()
                .await
                .map_err(ServerError::Storage)?
                .len()
                >= 100
            {
                return Err(ExportError::RestoreConflict);
            }
            let mut claimed = snapshot.clone();
            claimed.accept_eula = false;
            claimed.archive = Some(ArchiveReference {
                export_id: record.id.clone(),
                archived_at: timestamp(),
            });
            self.servers.repo.insert(&claimed).await?;
            claimed
        };
        let previous = server.archive.clone();
        server.software = snapshot.software;
        server.launch = snapshot.launch;
        server.jar = snapshot.jar;
        server.launch_override = snapshot.launch_override;
        server.docker_image = snapshot.docker_image;
        server.auto_java = snapshot.auto_java;
        server.archive = None;
        write_restored(files.join("server.properties"), content.as_bytes()).await?;
        write_restored(
            files.join("eula.txt"),
            format!("eula={}\n", server.accept_eula).as_bytes(),
        )
        .await?;
        crate::transitions::sync_root(&files).await?;
        let servers = self.servers.clone();
        let published = server.clone();
        let transition = Transition {
            id: server.id.clone(),
            kind: TransitionKind::Restore,
            staging: staging_name,
            previous,
            next: None,
        };
        self.servers
            .install_tasks
            .spawn(async move {
                let _lease = lease;
                progress.stage(Stage::Finalize);
                if let Some(properties) = &servers.properties_repo {
                    let state = properties
                        .state(&published.id)
                        .await
                        .map_err(|_| ExportError::Storage)?;
                    let expected = state
                        .desired
                        .as_ref()
                        .map(|revision| revision.metadata.etag.as_str());
                    let etag = format!("{:x}", Sha256::digest(content.as_bytes()));
                    properties
                        .append(&published.id, &content, &etag, "restore", expected, true)
                        .await
                        .map_err(|_| ExportError::Storage)?;
                    properties
                        .set_applied(&published.id, None, None)
                        .await
                        .map_err(|_| ExportError::Storage)?;
                }
                crate::transitions::publish(
                    &servers.root,
                    servers.repo.as_ref(),
                    &published,
                    &transition,
                    operation,
                )
                .await
            })
            .await
            .map_err(|_| ExportError::Storage)??;
        Ok(self.servers.view(server).await?)
    }
}
