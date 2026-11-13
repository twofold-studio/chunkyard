use crate::DownloadError;
use futures_util::StreamExt;
use reqwest::{Client, Url, header::LOCATION, redirect::Policy};
use serde::de::DeserializeOwned;
use sha2::{Digest, Sha256};
use std::{path::Path, sync::Arc, time::Duration};
use tokio::io::AsyncWriteExt;

/// Only fixed upstream hosts are accepted. Redirects are revalidated at every hop.
/// This client is not suitable for arbitrary user-supplied URLs.
#[derive(Clone)]
pub struct SafeHttp {
    client: Client,
    hosts: Arc<[String]>,
}

impl SafeHttp {
    pub fn adoptium() -> Result<Self, DownloadError> {
        let hosts = [
            "api.adoptium.net",
            "github.com",
            "objects.githubusercontent.com",
            "release-assets.githubusercontent.com",
        ];
        Ok(Self {
            client: Client::builder()
                .https_only(true)
                .no_proxy()
                .dns_resolver(crate::resolver::resolver())
                .redirect(Policy::none())
                .connect_timeout(Duration::from_secs(15))
                .timeout(Duration::from_secs(600))
                .user_agent("mcm/0.1.0")
                .build()?,
            hosts: hosts.into_iter().map(String::from).collect(),
        })
    }

    fn validate(&self, url: &Url) -> Result<(), DownloadError> {
        if url.scheme() != "https"
            || !url.username().is_empty()
            || url.password().is_some()
            || url.port_or_known_default() != Some(443)
            || !self
                .hosts
                .iter()
                .any(|host| Some(host.as_str()) == url.host_str())
        {
            return Err(DownloadError::ForbiddenUrl);
        }
        Ok(())
    }

    async fn get(&self, mut url: Url) -> Result<reqwest::Response, DownloadError> {
        for _ in 0..6 {
            self.validate(&url)?;
            let response = self.client.get(url.clone()).send().await?;
            if response.status().is_redirection() {
                let location = response
                    .headers()
                    .get(LOCATION)
                    .and_then(|v| v.to_str().ok())
                    .ok_or(DownloadError::Redirect)?;
                url = url.join(location).map_err(|_| DownloadError::Redirect)?;
            } else {
                return Ok(response.error_for_status()?);
            }
        }
        Err(DownloadError::Redirect)
    }

    pub async fn json<T: DeserializeOwned>(&self, url: Url) -> Result<T, DownloadError> {
        let mut response = self.get(url).await?;
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await? {
            if bytes.len() + chunk.len() > 4 * 1024 * 1024 {
                return Err(DownloadError::Size);
            }
            bytes.extend_from_slice(&chunk);
        }
        // Do not trust Content-Length for memory bounds.
        serde_json_decode(&bytes)
    }

    /// Writes only to a caller-owned staging directory; no partially verified final file.
    pub async fn download(
        &self,
        url: Url,
        destination: &Path,
        size: u64,
        sha256: &str,
    ) -> Result<(), DownloadError> {
        if size == 0 || size > 512 * 1024 * 1024 {
            return Err(DownloadError::Size);
        }
        let response = self.get(url).await?;
        write_verified(response, destination, size, sha256).await
    }
}

async fn write_verified(
    response: reqwest::Response,
    destination: &Path,
    size: u64,
    sha256: &str,
) -> Result<(), DownloadError> {
    if response.content_length().is_some_and(|n| n != size) {
        return Err(DownloadError::Size);
    }
    let mut file = tokio::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(destination)
        .await?;
    let mut stream = response.bytes_stream();
    let mut hasher = Sha256::new();
    let mut received = 0_u64;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        received += chunk.len() as u64;
        if received > size {
            return Err(DownloadError::Size);
        }
        hasher.update(&chunk);
        file.write_all(&chunk).await?;
    }
    if received != size {
        return Err(DownloadError::Size);
    }
    if format!("{:x}", hasher.finalize()) != sha256.to_ascii_lowercase() {
        return Err(DownloadError::Checksum);
    }
    file.sync_all().await?;
    Ok(())
}

fn serde_json_decode<T: DeserializeOwned>(bytes: &[u8]) -> Result<T, DownloadError> {
    serde_json::from_slice(bytes).map_err(DownloadError::Json)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_untrusted_urls() -> Result<(), Box<dyn std::error::Error>> {
        let client = SafeHttp::adoptium()?;
        for value in [
            "http://api.adoptium.net/",
            "https://127.0.0.1/",
            "https://api.adoptium.net.evil.com/",
            "https://user@github.com/",
            "https://github.com:444/",
        ] {
            assert!(client.validate(&Url::parse(value)?).is_err(), "{value}");
        }
        Ok(())
    }
}

#[cfg(test)]
mod streaming_tests {
    use super::*;
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
