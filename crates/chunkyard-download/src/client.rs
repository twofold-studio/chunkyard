use crate::DownloadError;
mod artifact;
use artifact::{write_artifact_progress, write_verified};
use reqwest::{Client, Url, header::LOCATION, redirect::Policy};
use serde::de::DeserializeOwned;
use std::{path::Path, sync::Arc, time::Duration};

/// Only fixed upstream hosts are accepted. Redirects are revalidated at every hop.
/// This client is not suitable for arbitrary user-supplied URLs.
#[derive(Clone)]
pub struct SafeHttp {
    client: Client,
    hosts: Arc<[String]>,
    progress: Option<Arc<dyn Fn(ArtifactProgress) + Send + Sync>>,
}

#[derive(Clone, Copy)]
pub enum ArtifactProgress {
    Bytes { completed: u64, total: u64 },
    Verify,
}

impl SafeHttp {
    pub fn with_progress(mut self, progress: Arc<dyn Fn(ArtifactProgress) + Send + Sync>) -> Self {
        self.progress = Some(progress);
        self
    }
    pub fn modpacks() -> Result<Self, DownloadError> {
        Self::with_hosts(&[
            "api.curseforge.com",
            "edge.forgecdn.net",
            "mediafilez.forgecdn.net",
            "mediafiles.forgecdn.net",
            "maven.minecraftforge.net",
            "maven.neoforged.net",
            "maven.fabricmc.net",
            "meta.fabricmc.net",
        ])
    }
    /// Public logo requests have their own allowlist and never carry API keys.
    pub fn logos() -> Result<Self, DownloadError> {
        Self::with_hosts(&[
            "media.forgecdn.net",
            "mediafilez.forgecdn.net",
            "mediafiles.forgecdn.net",
        ])
    }
    pub async fn icon_bytes(&self, url: Url) -> Result<Vec<u8>, DownloadError> {
        let mut response = self.get(url).await?;
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await? {
            if bytes.len() + chunk.len() > 2 * 1024 * 1024 {
                return Err(DownloadError::Size);
            }
            bytes.extend_from_slice(&chunk);
        }
        Ok(bytes)
    }
    /// Credentialed metadata requests never follow redirects or send the key to a CDN.
    pub async fn curseforge_json<T: DeserializeOwned>(
        &self,
        url: Url,
        key: &str,
    ) -> Result<T, DownloadError> {
        self.validate(&url)?;
        if url.host_str() != Some("api.curseforge.com") {
            return Err(DownloadError::ForbiddenUrl);
        }
        let mut key =
            reqwest::header::HeaderValue::from_str(key).map_err(|_| DownloadError::ForbiddenUrl)?;
        key.set_sensitive(true);
        let mut response = self
            .client
            .get(url)
            .header("x-api-key", key)
            .send()
            .await?
            .error_for_status()?;
        if response.status().is_redirection() {
            return Err(DownloadError::Redirect);
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await? {
            if bytes.len() + chunk.len() > 4 * 1024 * 1024 {
                return Err(DownloadError::Size);
            }
            bytes.extend_from_slice(&chunk);
        }
        serde_json_decode(&bytes)
    }
    pub async fn text(&self, url: Url) -> Result<String, DownloadError> {
        let mut response = self.get(url).await?;
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await? {
            if bytes.len() + chunk.len() > 128 * 1024 {
                return Err(DownloadError::Size);
            }
            bytes.extend_from_slice(&chunk);
        }
        String::from_utf8(bytes).map_err(|_| DownloadError::Checksum)
    }
    /// Published server ZIPs may exceed the smaller single-JAR download limit.
    pub async fn pack_artifact(
        &self,
        url: Url,
        path: &Path,
        size: u64,
        checksum: &str,
    ) -> Result<(), DownloadError> {
        if size == 0 || size > 2 * 1024 * 1024 * 1024 {
            return Err(DownloadError::Size);
        }
        let response = self.get(url).await?;
        write_artifact_progress(
            response,
            path,
            size,
            checksum,
            2 * 1024 * 1024 * 1024,
            self.progress.as_deref(),
        )
        .await
    }
    pub async fn installer_artifact(
        &self,
        url: Url,
        path: &Path,
        checksum: &str,
    ) -> Result<(), DownloadError> {
        let response = self.get(url).await?;
        let size = response.content_length().ok_or(DownloadError::Size)?;
        write_artifact_progress(
            response,
            path,
            size,
            checksum,
            512 * 1024 * 1024,
            self.progress.as_deref(),
        )
        .await
    }
    pub fn adoptium() -> Result<Self, DownloadError> {
        let hosts = [
            "api.adoptium.net",
            "github.com",
            "objects.githubusercontent.com",
            "release-assets.githubusercontent.com",
        ];
        Self::with_hosts(&hosts)
    }

    pub fn minecraft() -> Result<Self, DownloadError> {
        Self::with_hosts(&[
            "piston-meta.mojang.com",
            "piston-data.mojang.com",
            "launchermeta.mojang.com",
            "launcher.mojang.com",
            "fill.papermc.io",
            "fill-data.papermc.io",
        ])
    }

    fn with_hosts(hosts: &[&str]) -> Result<Self, DownloadError> {
        Ok(Self {
            client: Client::builder()
                .https_only(true)
                .no_proxy()
                .dns_resolver(crate::resolver::resolver())
                .redirect(Policy::none())
                .connect_timeout(Duration::from_secs(15))
                .timeout(Duration::from_secs(600))
                .user_agent("Chunkyard/0.1.0 (https://chunkyard.fractal-tess.xyz)")
                .build()?,
            hosts: hosts.iter().map(|host| String::from(*host)).collect(),
            progress: None,
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

    /// Minecraft publishes SHA-1; Paper publishes SHA-256. Both are size bounded.
    pub async fn artifact(
        &self,
        url: Url,
        destination: &Path,
        size: u64,
        checksum: &str,
    ) -> Result<(), DownloadError> {
        if size == 0 || size > 512 * 1024 * 1024 {
            return Err(DownloadError::Size);
        }
        let response = self.get(url).await?;
        write_artifact_progress(
            response,
            destination,
            size,
            checksum,
            512 * 1024 * 1024,
            self.progress.as_deref(),
        )
        .await
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

fn serde_json_decode<T: DeserializeOwned>(bytes: &[u8]) -> Result<T, DownloadError> {
    serde_json::from_slice(bytes).map_err(DownloadError::Json)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn logo_policy_never_accepts_api_hosts_private_addresses_or_credentials()
    -> Result<(), Box<dyn std::error::Error>> {
        let client = SafeHttp::logos()?;
        for url in [
            "https://api.curseforge.com/v1/mods",
            "https://127.0.0.1/icon.png",
            "http://media.forgecdn.net/a.png",
            "https://user@media.forgecdn.net/a.png",
            "https://media.forgecdn.net.evil.test/a.png",
        ] {
            assert!(client.validate(&Url::parse(url)?).is_err());
        }
        client.validate(&Url::parse(
            "https://media.forgecdn.net/avatars/1/2/icon.png",
        )?)?;
        Ok(())
    }
    #[test]
    fn minecraft_policy_is_separate_from_java_and_rejects_private_or_external_urls()
    -> Result<(), Box<dyn std::error::Error>> {
        let client = SafeHttp::minecraft()?;
        for value in [
            "http://piston-data.mojang.com/server.jar",
            "https://127.0.0.1/",
            "https://fill.papermc.io.evil.com/",
            "https://user@fill.papermc.io/",
            "https://github.com/file",
            "https://api.curseforge.com/",
        ] {
            assert!(client.validate(&Url::parse(value)?).is_err(), "{value}");
        }
        for value in [
            "https://piston-data.mojang.com/server.jar",
            "https://fill-data.papermc.io/file",
        ] {
            client.validate(&Url::parse(value)?)?;
        }
        Ok(())
    }
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
