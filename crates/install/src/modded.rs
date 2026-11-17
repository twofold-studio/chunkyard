//! Standalone loaders use the same isolated installation/publication path as packs.
use crate::{Installers, catalogs::FABRIC, client::string, purpur::sha256};
use chunkyard_core::software::*;
use std::{path::Path, sync::Arc};
use url::Url;

impl Installers {
    pub(super) async fn modded_plan(
        &self,
        software: &Software,
        directory: &Path,
        _lease: Arc<dyn Send + Sync>,
    ) -> Result<PreparedSoftware, SoftwareError> {
        software.validate()?;
        let (kind, loader, loader_version) = match software {
            Software::Fabric { loader_version, .. } => {
                ("fabric", LoaderType::Fabric, loader_version)
            }
            Software::Forge { loader_version, .. } => ("forge", LoaderType::Forge, loader_version),
            Software::NeoForge { loader_version, .. } => {
                ("neoforge", LoaderType::NeoForge, loader_version)
            }
            _ => return Err(SoftwareError::Invalid),
        };
        let mc = software.version();
        let builds = self.extra_builds(kind, mc).await?;
        if !builds["items"]
            .as_array()
            .ok_or(SoftwareError::Upstream)?
            .iter()
            .any(|entry| entry["id"] == *loader_version)
        {
            return Err(SoftwareError::Invalid);
        }
        let metadata = self.vanilla(mc).await?;
        let java = metadata["javaVersion"]["majorVersion"]
            .as_u64()
            .unwrap_or(8);
        let java = u16::try_from(java).map_err(|_| SoftwareError::Upstream)?;
        let root = directory.join("pack");
        tokio::fs::create_dir(&root)
            .await
            .map_err(|_| SoftwareError::Filesystem)?;
        let options = InstallOptions {
            minecraft_version: Some(mc.into()),
            loader: Some(loader),
            loader_version: Some(loader_version.clone()),
            java_major: Some(java),
            launch: None,
        };
        let mut plan = crate::pack::inspect(&root, &options, None, None)?;
        // Resolve a current stable Fabric installer separately from the selected loader.
        if loader == LoaderType::Fabric {
            let metadata = self.json(&format!("{FABRIC}/installer")).await?;
            let installer = metadata
                .as_array()
                .ok_or(SoftwareError::Upstream)?
                .iter()
                .find(|v| v["stable"] == true)
                .ok_or(SoftwareError::Upstream)?;
            let version = string(installer, "version")?;
            component(version)?;
            let path = format!("fabric-installer-{version}.jar");
            if let Some((url, name, _)) = &mut plan.install {
                *url = format!(
                    "https://maven.fabricmc.net/net/fabricmc/fabric-installer/{version}/{path}"
                );
                *name = path;
            }
        }
        let (url, path, args) = plan.install.ok_or(SoftwareError::Upstream)?;
        let checksum = self
            .http
            .text(Url::parse(&format!("{url}.sha1")).map_err(|_| SoftwareError::Upstream)?)
            .await
            .map_err(|_| SoftwareError::Upstream)?;
        let checksum = checksum
            .split_whitespace()
            .next()
            .ok_or(SoftwareError::Upstream)?;
        if checksum.len() != 40 {
            return Err(SoftwareError::Upstream);
        }
        self.http
            .installer_artifact(
                Url::parse(&url).map_err(|_| SoftwareError::Upstream)?,
                &root.join(&path),
                checksum,
            )
            .await
            .map_err(|_| SoftwareError::Download)?;
        Ok(PreparedSoftware {
            launch: Launch {
                path: plan.profile.path,
                version: mc.into(),
                build: Some(loader_version.clone()),
                java_major: java,
                checksum: sha256(&root.join(&path)).await?,
                loader: plan.loader,
                profile: Some(LaunchOptions {
                    mode: plan.profile.mode,
                    jvm_args: plan.profile.jvm_args,
                    args: plan.profile.args,
                }),
            },
            installer: Some(InstallerCommand {
                path,
                args,
                java_major: java,
            }),
            instance_files: true,
        })
    }
}
