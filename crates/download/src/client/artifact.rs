//! Bounded artifact streaming and checksum verification.
use super::{ArtifactProgress, DownloadError};
use futures_util::StreamExt;
use sha2::{Digest, Sha256};
use std::path::Path;
use tokio::io::AsyncWriteExt;

pub(super) async fn write_verified(
    response: reqwest::Response,
    destination: &Path,
    size: u64,
    sha256: &str,
) -> Result<(), DownloadError> {
    if sha256.len() != 64 {
        return Err(DownloadError::Checksum);
    }
    write_artifact(response, destination, size, sha256, 512 * 1024 * 1024).await
}
async fn write_artifact(
    response: reqwest::Response,
    destination: &Path,
    size: u64,
    checksum: &str,
    max_size: u64,
) -> Result<(), DownloadError> {
    write_artifact_progress(response, destination, size, checksum, max_size, None).await
}
pub(super) async fn write_artifact_progress(
    response: reqwest::Response,
    destination: &Path,
    size: u64,
    checksum: &str,
    max_size: u64,
    progress: Option<&(dyn Fn(ArtifactProgress) + Send + Sync)>,
) -> Result<(), DownloadError> {
    let limit = size;
    if size == 0
        || size > max_size
        || !matches!(checksum.len(), 32 | 40 | 64)
        || !checksum.bytes().all(|b| b.is_ascii_hexdigit())
    {
        return Err(DownloadError::Checksum);
    }
    if response.content_length().is_some_and(|n| n != size) {
        return Err(DownloadError::Size);
    }
    let mut file = tokio::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(destination)
        .await?;
    let mut stream = response.bytes_stream();
    let mut received = 0u64;
    let mut hasher = ArtifactHash::new(checksum.len());
    if let Some(report) = progress {
        report(ArtifactProgress::Bytes {
            completed: 0,
            total: size,
        });
    }
    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        received += chunk.len() as u64;
        if received > limit {
            return Err(DownloadError::Size);
        }
        hasher.update(&chunk);
        file.write_all(&chunk).await?;
        if let Some(report) = progress {
            report(ArtifactProgress::Bytes {
                completed: received,
                total: size,
            });
        }
    }
    if received == 0 || size != received {
        return Err(DownloadError::Size);
    }
    if let Some(report) = progress {
        report(ArtifactProgress::Verify);
    }
    if hasher.finish() != checksum.to_ascii_lowercase() {
        return Err(DownloadError::Checksum);
    }
    file.sync_all().await?;
    Ok(())
}

enum ArtifactHash {
    Md5(md5::Md5),
    Sha1(sha1::Sha1),
    Sha256(Sha256),
}
impl ArtifactHash {
    fn new(length: usize) -> Self {
        if length == 32 {
            Self::Md5(md5::Md5::new())
        } else if length == 40 {
            Self::Sha1(sha1::Sha1::new())
        } else {
            Self::Sha256(Sha256::new())
        }
    }
    fn update(&mut self, chunk: &[u8]) {
        match self {
            Self::Md5(hash) => hash.update(chunk),
            Self::Sha1(h) => h.update(chunk),
            Self::Sha256(h) => h.update(chunk),
        }
    }
    fn finish(self) -> String {
        match self {
            Self::Md5(hash) => format!("{:x}", hash.finalize()),
            Self::Sha1(h) => format!("{:x}", h.finalize()),
            Self::Sha256(h) => format!("{:x}", h.finalize()),
        }
    }
}

#[cfg(test)]
mod streaming_tests {
    use super::*;
    use reqwest::Client;
    #[tokio::test]
    async fn md5_is_not_accepted_by_other_provider_entry_points()
    -> Result<(), Box<dyn std::error::Error>> {
        let client = crate::SafeHttp::minecraft()?;
        let directory = tempfile::tempdir()?;
        let path = directory.path().join("never-created");
        let url = reqwest::Url::parse("https://piston-data.mojang.com/server.jar")?;
        let md5 = "900150983cd24fb0d6963f7d28e17f72";
        assert!(matches!(
            client.artifact(url.clone(), &path, 3, md5).await,
            Err(DownloadError::Checksum)
        ));
        assert!(matches!(
            client.pack_artifact(url.clone(), &path, 3, md5).await,
            Err(DownloadError::Checksum)
        ));
        assert!(matches!(
            client.installer_artifact(url.clone(), &path, md5).await,
            Err(DownloadError::Checksum)
        ));
        assert!(matches!(
            client.purpur_artifact(url, &path, md5).await,
            Err(DownloadError::ForbiddenUrl)
        ));
        assert!(!path.exists());
        Ok(())
    }
    #[tokio::test]
    async fn legacy_md5_transfer_check_never_weakens_sha256_only_downloads()
    -> Result<(), Box<dyn std::error::Error>> {
        let root = tempfile::tempdir()?;
        let md5 = "900150983cd24fb0d6963f7d28e17f72";
        write_artifact(response().await?, &root.path().join("valid"), 3, md5, 512).await?;
        assert!(matches!(
            write_artifact(
                response().await?,
                &root.path().join("corrupt"),
                3,
                &"0".repeat(32),
                512
            )
            .await,
            Err(DownloadError::Checksum)
        ));
        assert!(matches!(
            write_verified(
                response().await?,
                &root.path().join("sha256-required"),
                3,
                md5
            )
            .await,
            Err(DownloadError::Checksum)
        ));
        Ok(())
    }
    #[tokio::test]
    async fn download_reports_observed_bytes_then_verification()
    -> Result<(), Box<dyn std::error::Error>> {
        let events = std::sync::Mutex::new(Vec::new());
        let report = |event| {
            if let Ok(mut events) = events.lock() {
                events.push(event);
            }
        };
        let dir = tempfile::tempdir()?;
        let checksum = format!("{:x}", Sha256::digest(b"abc"));
        write_artifact_progress(
            response().await?,
            &dir.path().join("jar"),
            3,
            &checksum,
            512,
            Some(&report),
        )
        .await?;
        let events = events.into_inner().map_err(|_| "events lock")?;
        assert!(matches!(
            events.first(),
            Some(ArtifactProgress::Bytes {
                completed: 0,
                total: 3
            })
        ));
        assert!(events.iter().any(|e| matches!(
            e,
            ArtifactProgress::Bytes {
                completed: 3,
                total: 3
            }
        )));
        assert!(matches!(events.last(), Some(ArtifactProgress::Verify)));
        Ok(())
    }
    use tokio::{
        io::{AsyncReadExt, AsyncWriteExt},
        net::TcpListener,
    };

    async fn response() -> Result<reqwest::Response, Box<dyn std::error::Error>> {
        let listener = TcpListener::bind("127.0.0.1:0").await?;
        let address = listener.local_addr()?;
        tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await?;
            let mut request = [0; 4096];
            let count = socket.read(&mut request).await?;
            if count == 0 {
                return Ok(());
            }
            socket
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 3\r\nConnection: close\r\n\r\nabc")
                .await?;
            Ok::<_, std::io::Error>(())
        });
        Ok(Client::builder()
            .no_proxy()
            .build()?
            .get(format!("http://{address}"))
            .send()
            .await?)
    }

    #[tokio::test]
    async fn verifies_checksum_and_refuses_to_overwrite_files()
    -> Result<(), Box<dyn std::error::Error>> {
        let dir = tempfile::tempdir()?;
        let path = dir.path().join("download");
        let checksum = format!("{:x}", Sha256::digest(b"abc"));
        write_verified(response().await?, &path, 3, &checksum).await?;
        assert_eq!(tokio::fs::read(&path).await?, b"abc");
        assert!(
            write_verified(response().await?, &path, 3, &checksum)
                .await
                .is_err()
        );
        Ok(())
    }
    #[tokio::test]
    async fn verifies_mojang_sha1_and_rejects_a_corrupt_artifact()
    -> Result<(), Box<dyn std::error::Error>> {
        let dir = tempfile::tempdir()?;
        let checksum = format!("{:x}", sha1::Sha1::digest(b"abc"));
        write_artifact(
            response().await?,
            &dir.path().join("valid"),
            3,
            &checksum,
            512 * 1024 * 1024,
        )
        .await?;
        assert_eq!(tokio::fs::read(dir.path().join("valid")).await?, b"abc");
        assert!(matches!(
            write_artifact(
                response().await?,
                &dir.path().join("corrupt"),
                3,
                &"0".repeat(40),
                512 * 1024 * 1024
            )
            .await,
            Err(DownloadError::Checksum)
        ));
        assert!(
            write_verified(
                response().await?,
                &dir.path().join("not-sha256"),
                3,
                &checksum
            )
            .await
            .is_err()
        );
        Ok(())
    }
    #[tokio::test]
    async fn rejects_corruption_and_wrong_size() -> Result<(), Box<dyn std::error::Error>> {
        let dir = tempfile::tempdir()?;
        assert!(matches!(
            write_verified(
                response().await?,
                &dir.path().join("corrupt"),
                3,
                &"0".repeat(64)
            )
            .await,
            Err(DownloadError::Checksum)
        ));
        assert!(matches!(
            write_verified(
                response().await?,
                &dir.path().join("oversized"),
                2,
                &"0".repeat(64)
            )
            .await,
            Err(DownloadError::Size)
        ));
        Ok(())
    }
}
