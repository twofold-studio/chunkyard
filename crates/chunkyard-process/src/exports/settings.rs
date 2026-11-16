use super::*;
impl ExportManager {
    pub(super) async fn set_storage_inner(
        &self,
        mut connection: StorageConnection,
    ) -> Result<StorageView, ExportError> {
        connection.prefix = connection.prefix.trim_end_matches('/').to_owned();
        let guard = Arc::new(
            self.operation
                .clone()
                .try_lock_owned()
                .map_err(|_| ExportError::Busy)?,
        );
        let old = self.connection().await?;
        let identity_changed = connection.endpoint != old.endpoint
            || connection.bucket != old.bucket
            || connection.region != old.region
            || connection.prefix != old.prefix
            || connection.access_key_id != old.access_key_id;
        if identity_changed
            && self
                .list()
                .await?
                .iter()
                .any(|e| e.destination == ExportDestination::S3)
        {
            return Err(ExportError::Busy);
        }
        if connection
            .secret_access_key
            .as_deref()
            .is_none_or(str::is_empty)
        {
            if connection.endpoint != old.endpoint || connection.access_key_id != old.access_key_id
            {
                return Err(ExportError::Invalid);
            }
            connection.secret_access_key = old.secret_access_key;
        }
        storage::client(&connection)?;
        let bytes = serde_json::to_vec(&connection).map_err(|_| ExportError::Invalid)?;
        private_write(self.root.join("storage.json"), bytes, guard).await?;
        Ok(storage::view(connection))
    }
    pub(super) async fn storage_inner(&self) -> Result<StorageView, ExportError> {
        Ok(storage::view(self.connection().await?))
    }
    pub(super) async fn test_storage_inner(&self) -> Result<(), ExportError> {
        let _guard = self.operation.try_lock().map_err(|_| ExportError::Busy)?;
        let connection = self.connection().await?;
        let (bucket, credentials) = storage::client(&connection)?;
        let key = storage::object_key(&connection, &format!("connection-test-{}", Uuid::new_v4()));
        let content = Uuid::new_v4().as_bytes().to_vec();
        use rusty_s3::S3Action;
        let put = bucket
            .put_object(Some(&credentials), &key)
            .sign(storage::EXPIRY);
        let result = async {
            storage::success(self.http.put(put).body(content.clone()).send().await)?;
            let get = bucket
                .get_object(Some(&credentials), &key)
                .sign(storage::EXPIRY);
            let mut response = storage::success(self.http.get(get).send().await)?;
            let mut bytes = Vec::new();
            while let Some(chunk) = response.chunk().await.map_err(|_| ExportError::Storage)? {
                if bytes.len() + chunk.len() > content.len() {
                    return Err(ExportError::Storage);
                }
                bytes.extend_from_slice(&chunk);
            }
            if bytes != content {
                return Err(ExportError::Storage);
            }
            Ok(())
        }
        .await;
        let delete = bucket
            .delete_object(Some(&credentials), &key)
            .sign(storage::EXPIRY);
        let cleanup = storage::success(self.http.delete(delete).send().await).map(|_| ());
        result.and(cleanup)
    }
}
