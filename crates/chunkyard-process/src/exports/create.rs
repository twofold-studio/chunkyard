use super::*;

impl ExportManager {
    pub(super) async fn create_archive(
        &self,
        server_id: &str,
        request: ExportRequest,
        progress: chunkyard_core::progress::ProgressReporter,
    ) -> Result<Export, ExportError> {
        if (request.scope == ExportScope::Selected
            && (request.paths.is_empty() || request.paths.len() > 100))
            || (request.scope != ExportScope::Selected && !request.paths.is_empty())
        {
            return Err(ExportError::Invalid);
        }
        let operation = Arc::new(
            self.operation
                .clone()
                .try_lock_owned()
                .map_err(|_| ExportError::Busy)?,
        );
        let connection = self.connection().await?;
        if request.destination == ExportDestination::S3 {
            storage::client(&connection)?;
        }
        let server = self.servers.local_record(server_id).await?;
        let instance = self.servers.archive_instance(&server.id, false).await?;
        let guard = instance.guard();
        let server = instance.local_record().await?;
        if instance.status(&server).await?.state != ServerState::Stopped {
            return Err(chunkyard_core::files::FileError::Running.into());
        }
        let desired = instance.desired_properties().await?;
        let manifest = serde_json::to_vec_pretty(&serde_json::json!({
            "formatVersion": 1,
            "server": server,
            "properties": "Latest saved configuration, applied on next start. EULA is not transferable acceptance."
        })).map_err(|_| ExportError::Invalid)?;
        let id = Uuid::new_v4().to_string();
        let mut record = Export {
            id: id.clone(),
            server_id: server.id.clone(),
            server_name: server.name.clone(),
            scope: request.scope,
            destination: request.destination,
            created_at: timestamp(),
            size: 0,
            sha256: String::new(),
            file_name: format!("chunkyard-{id}.tar.gz"),
            object_key: None,
        };
        let root = instance.root();
        let exports = self.root.clone();
        let worker_operation = operation.clone();
        let worker_guard = guard.clone();
        let archive_progress = progress.clone();
        let (temp, size, hash) = tokio::task::spawn_blocking(move || -> Result<_, ExportError> {
            let _operation = worker_operation;
            let _guard = worker_guard;
            let temp = tempfile::Builder::new()
                .prefix(".export-")
                .tempfile_in(exports)?;
            let fs = chunkyard_fs::sandbox::Sandbox::open(&root, &server.id)?;
            let (size, hash) = fs
                .export_archive_with_progress(
                    &request.paths,
                    request.scope == ExportScope::World,
                    temp.reopen()?,
                    &manifest,
                    desired.as_deref(),
                    archive_progress,
                )
                .map_err(|e| match e {
                    chunkyard_core::files::FileError::TooLarge => ExportError::Limit,
                    chunkyard_core::files::FileError::Io(ref io)
                        if io.kind() == std::io::ErrorKind::FileTooLarge =>
                    {
                        ExportError::Limit
                    }
                    other => ExportError::Files(other),
                })?;
            Ok((temp, size, hash))
        })
        .await
        .map_err(|_| std::io::Error::other("archive worker failed"))??;
        record.size = size;
        record.sha256 = hash;
        if record.destination == ExportDestination::S3 {
            let key = storage::object_key(&connection, &record.file_name);
            self.upload_verified(
                &connection,
                &key,
                temp.path(),
                size,
                &record.sha256,
                progress.clone(),
            )
            .await?;
            record.object_key = Some(key);
        } else {
            // Atomic publication; UUIDs make collisions impossible without corrupted storage.
            temp.persist_noclobber(self.root.join(&record.file_name))
                .map_err(|e| e.error)?;
        }
        progress.stage(chunkyard_core::progress::Stage::Finalize);
        let bytes = serde_json::to_vec(&record).map_err(|_| ExportError::Invalid)?;
        private_write(
            self.root.join(format!("{}.json", record.id)),
            bytes,
            operation,
        )
        .await?;
        Ok(record)
    }
}
