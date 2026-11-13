use crate::{
    JavaError,
    platform::{host_arch, host_os},
};
use async_trait::async_trait;
use mcm_download::SafeHttp;
use reqwest::Url;
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize, Serialize)]
pub struct Releases {
    pub available_releases: Vec<u16>,
    pub available_lts_releases: Vec<u16>,
    pub most_recent_lts: u16,
}

#[derive(Debug, Clone)]
pub struct JavaAsset {
    pub version: String,
    pub major: u16,
    pub url: Url,
    pub checksum: String,
    pub size: u64,
    pub zip: bool,
}

#[async_trait]
pub trait AdoptiumApi: Send + Sync {
    async fn releases(&self) -> Result<Releases, JavaError>;
    async fn latest(&self, major: u16) -> Result<JavaAsset, JavaError>;
}

pub struct Adoptium {
    http: SafeHttp,
}
impl Adoptium {
    pub fn new(http: SafeHttp) -> Self {
        Self { http }
    }
}

#[derive(Deserialize)]
struct Asset {
    binary: Binary,
    version: Version,
}
#[derive(Deserialize)]
struct Binary {
    package: Package,
}
#[derive(Deserialize)]
struct Package {
    link: String,
    checksum: String,
    size: u64,
    name: String,
}
#[derive(Deserialize)]
struct Version {
    semver: String,
    major: u16,
}

#[async_trait]
impl AdoptiumApi for Adoptium {
    async fn releases(&self) -> Result<Releases, JavaError> {
        let url = Url::parse("https://api.adoptium.net/v3/info/available_releases")
            .map_err(|_| JavaError::Unavailable)?;
        Ok(self.http.json(url).await?)
    }
    async fn latest(&self, major: u16) -> Result<JavaAsset, JavaError> {
        let mut url = Url::parse(&format!(
            "https://api.adoptium.net/v3/assets/latest/{major}/hotspot"
        ))
        .map_err(|_| JavaError::Unavailable)?;
        url.query_pairs_mut().extend_pairs([
            ("architecture", host_arch()?),
            ("image_type", "jre"),
            ("os", host_os()?),
            ("vendor", "eclipse"),
        ]);
        let assets: Vec<Asset> = self.http.json(url).await?;
        let suffix = if cfg!(windows) { ".zip" } else { ".tar.gz" };
        let asset = assets
            .into_iter()
            .find(|asset| {
                asset.version.major == major && asset.binary.package.name.ends_with(suffix)
            })
            .ok_or(JavaError::Unavailable)?;
        let package = asset.binary.package;
        if package.checksum.len() != 64 || !package.checksum.bytes().all(|c| c.is_ascii_hexdigit())
        {
            return Err(JavaError::Verify);
        }
        Ok(JavaAsset {
            version: asset.version.semver,
            major,
            url: Url::parse(&package.link).map_err(|_| JavaError::Unavailable)?,
            checksum: package.checksum,
            size: package.size,
            zip: cfg!(windows),
        })
    }
}
