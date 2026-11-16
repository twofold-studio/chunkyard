use super::*;
impl ExportManager {
    pub(super) async fn list_inner(&self) -> Result<Vec<Export>, ExportError> {
        let mut dir = tokio::fs::read_dir(&self.root).await?;
        let mut records = Vec::new();
        let mut inspected = 0;
        while let Some(entry) = dir.next_entry().await? {
            inspected += 1;
            if inspected > 20_000 {
                return Err(ExportError::Limit);
            }
            let name = entry.file_name();
            let Some(name) = name.to_str() else {
                continue;
            };
            if let Some(id) = name.strip_suffix(".json")
                && Uuid::parse_str(id).is_ok()
            {
                records.push(self.record(id).await?);
            }
        }
        records.sort_by(|a, b| {
            b.created_at
                .cmp(&a.created_at)
                .then_with(|| b.id.cmp(&a.id))
        });
        Ok(records)
    }
    pub(super) async fn download_inner(&self, id: &str) -> Result<ExportDownload, ExportError> {
        let record = self.record(id).await?;
        let stream = if record.destination == ExportDestination::S3 {
            let connection = self.connection().await?;
            let (bucket, credentials) = storage::client(&connection)?;
            let key = record.object_key.as_deref().ok_or(ExportError::Storage)?;
            use rusty_s3::S3Action;
            let url = bucket
                .get_object(Some(&credentials), key)
                .sign(storage::EXPIRY);
            let response = storage::success(self.http.get(url).send().await)?;
            if response.content_length() != Some(record.size) {
                return Err(ExportError::Storage);
            }
            Box::pin(response.bytes_stream().map(|r| {
                r.map(|b| b.to_vec())
                    .map_err(|_| std::io::Error::other("archive transfer interrupted"))
            })) as _
        } else {
            let file = tokio::fs::File::open(self.root.join(&record.file_name)).await?;
            Box::pin(tokio_util::io::ReaderStream::new(file).map(|r| r.map(|b| b.to_vec()))) as _
        };
        Ok(ExportDownload {
            name: record.file_name,
            size: record.size,
            stream,
        })
    }
    pub(super) async fn delete_inner(&self, id: &str) -> Result<(), ExportError> {
        let _guard = self.operation.try_lock().map_err(|_| ExportError::Busy)?;
        let record = self.record(id).await?;
        if self.servers.archive_is_pinned(&record.id).await? {
            return Err(ExportError::BackupRequired);
        }
        if record.destination == ExportDestination::S3 {
            let connection = self.connection().await?;
            let (bucket, credentials) = storage::client(&connection)?;
            use rusty_s3::S3Action;
            let key = record.object_key.as_deref().ok_or(ExportError::Storage)?;
            storage::success(
                self.http
                    .delete(
                        bucket
                            .delete_object(Some(&credentials), key)
                            .sign(storage::EXPIRY),
                    )
                    .send()
                    .await,
            )?;
        } else {
            match tokio::fs::remove_file(self.root.join(&record.file_name)).await {
                Ok(()) => (),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
                Err(e) => return Err(e.into()),
            }
        }
        tokio::fs::remove_file(self.root.join(format!("{}.json", record.id))).await?;
        Ok(())
    }
}
