use super::*;
use rusty_s3::{Bucket, Credentials, S3Action, UrlStyle};
pub(super) const EXPIRY: std::time::Duration = std::time::Duration::from_secs(3600);

pub(super) fn view(c: StorageConnection) -> StorageView {
    StorageView {
        configured: c
            .secret_access_key
            .as_deref()
            .is_some_and(|s| !s.is_empty()),
        endpoint: c.endpoint,
        region: c.region,
        bucket: c.bucket,
        prefix: c.prefix,
        access_key_id: c.access_key_id,
        has_secret: c
            .secret_access_key
            .as_deref()
            .is_some_and(|s| !s.is_empty()),
    }
}
pub(super) fn client(c: &StorageConnection) -> Result<(Bucket, Credentials), ExportError> {
    let url = url::Url::parse(&c.endpoint).map_err(|_| ExportError::Invalid)?;
    let secret = c
        .secret_access_key
        .as_deref()
        .filter(|s| !s.is_empty())
        .ok_or(ExportError::Invalid)?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || url.path() != "/"
        || !(3..=63).contains(&c.bucket.len())
        || !c
            .bucket
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b".-".contains(&b))
        || c.bucket.starts_with(['.', '-'])
        || c.bucket.ends_with(['.', '-'])
        || c.bucket.contains("..")
        || c.region.is_empty()
        || c.region.len() > 64
        || !c
            .region
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-')
        || c.access_key_id.is_empty()
        || c.access_key_id.len() > 256
        || c.access_key_id.chars().any(char::is_control)
        || secret.len() > 4096
        || secret.chars().any(char::is_control)
        || c.prefix.len() > 256
        || (!c.prefix.is_empty()
            && c.prefix.split('/').any(|p| {
                p.is_empty()
                    || p == "."
                    || p == ".."
                    || !p
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b"-_.".contains(&b))
            }))
    {
        return Err(ExportError::Invalid);
    }
    let bucket = Bucket::new(url, UrlStyle::Path, c.bucket.clone(), c.region.clone())
        .map_err(|_| ExportError::Invalid)?;
    Ok((bucket, Credentials::new(c.access_key_id.clone(), secret)))
}
pub(super) fn object_key(c: &StorageConnection, name: &str) -> String {
    if c.prefix.is_empty() {
        name.into()
    } else {
        format!("{}/{name}", c.prefix)
    }
}
pub(super) fn success(
    response: Result<reqwest::Response, reqwest::Error>,
) -> Result<reqwest::Response, ExportError> {
    let response = response.map_err(|_| ExportError::Storage)?;
    if !response.status().is_success() {
        return Err(ExportError::Storage);
    }
    Ok(response)
}
impl ExportManager {
    pub(super) async fn upload_verified(
        &self,
        c: &StorageConnection,
        key: &str,
        path: &Path,
        size: u64,
        expected: &str,
        progress: mcm_core::progress::ProgressReporter,
    ) -> Result<(), ExportError> {
        let (bucket, credentials) = client(c)?;
        let file = tokio::fs::File::open(path).await?;
        use mcm_core::progress::Stage;
        progress.bytes(Stage::Upload, Some(0), Some(size));
        let sent_progress = progress.clone();
        let mut sent = 0;
        let body =
            reqwest::Body::wrap_stream(tokio_util::io::ReaderStream::new(file).map(move |chunk| {
                if let Ok(bytes) = &chunk {
                    sent += bytes.len() as u64;
                    sent_progress.bytes(Stage::Upload, Some(sent), Some(size));
                }
                chunk
            }));
        success(
            self.http
                .put(bucket.put_object(Some(&credentials), key).sign(EXPIRY))
                .header("content-length", size)
                .header("content-type", "application/gzip")
                .body(body)
                .send()
                .await,
        )?;
        progress.bytes(Stage::VerifyUpload, Some(0), Some(size));
        let result = async {
            let mut response = success(
                self.http
                    .get(bucket.get_object(Some(&credentials), key).sign(EXPIRY))
                    .send()
                    .await,
            )?;
            let mut hash = Sha256::new();
            let mut received = 0u64;
            while let Some(chunk) = response.chunk().await.map_err(|_| ExportError::Storage)? {
                received += chunk.len() as u64;
                if received > size {
                    return Err(ExportError::Storage);
                }
                hash.update(&chunk);
                progress.bytes(Stage::VerifyUpload, Some(received), Some(size));
            }
            if received != size || format!("{:x}", hash.finalize()) != expected {
                return Err(ExportError::Storage);
            }
            Ok(())
        }
        .await;
        if result.is_err() {
            let _ = self
                .http
                .delete(bucket.delete_object(Some(&credentials), key).sign(EXPIRY))
                .send()
                .await;
        }
        result
    }
}
