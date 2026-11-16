use crate::{Installers, catalogs::PURPUR, client::string, providers::paper_java};
use chunkyard_core::software::{Launch, SoftwareError};
use sha2::{Digest, Sha256};
use std::path::Path;
use tokio::io::AsyncReadExt;
use url::Url;

pub(super) async fn sha256(path: &Path) -> Result<String, SoftwareError> {
    let mut file = tokio::fs::File::open(path)
        .await
        .map_err(|_| SoftwareError::Filesystem)?;
    let mut hash = Sha256::new();
    let mut buffer = vec![0; 128 * 1024];
    loop {
        let count = file
            .read(&mut buffer)
            .await
            .map_err(|_| SoftwareError::Filesystem)?;
        if count == 0 {
            break;
        }
        hash.update(&buffer[..count]);
    }
    Ok(format!("{:x}", hash.finalize()))
}

impl Installers {
    pub(super) async fn purpur(
        &self,
        version: &str,
        build: Option<&str>,
        directory: &Path,
    ) -> Result<Launch, SoftwareError> {
        // Resolve even an omitted build to an immutable numbered artifact before fetching.
        let metadata = self
            .json(&format!("{PURPUR}/{version}/{}", build.unwrap_or("latest")))
            .await?;
        let selected = string(&metadata, "build")?;
        if metadata["result"] != "SUCCESS"
            || metadata["version"] != version
            || !selected
                .parse::<u32>()
                .is_ok_and(|n| n > 0 && n.to_string() == selected)
            || build.is_some_and(|id| id != selected)
        {
            return Err(SoftwareError::Invalid);
        }
        let checksum = string(&metadata, "md5")?;
        if checksum.len() != 32 {
            return Err(SoftwareError::Upstream);
        }
        let path = directory.join("server.jar");
        // Purpur publishes MD5. HTTPS authenticates the origin; MD5 checks transfer
        // integrity only. Record a SHA-256 fingerprint rather than mislabelling MD5.
        self.http
            .purpur_artifact(
                Url::parse(&format!("{PURPUR}/{version}/{selected}/download"))
                    .map_err(|_| SoftwareError::Upstream)?,
                &path,
                checksum,
            )
            .await
            .map_err(|_| SoftwareError::Download)?;
        Ok(Launch {
            profile: None,
            loader: None,
            path: "server.jar".into(),
            version: version.into(),
            java_major: paper_java(version),
            build: Some(selected.into()),
            checksum: sha256(&path).await?,
        })
    }
}
