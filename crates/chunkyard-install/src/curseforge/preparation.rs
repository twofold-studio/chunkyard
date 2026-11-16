//! Download, verify and inspect a published server pack while retaining staging leases.
use super::Installers;
use chunkyard_core::software::*;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{io::Read, path::Path};

impl Installers {
    pub(crate) async fn cf_prepare(
        &self,
        project: u64,
        file: u64,
        directory: &Path,
        options: &InstallOptions,
        lease: std::sync::Arc<dyn Send + Sync>,
    ) -> Result<PreparedSoftware, SoftwareError> {
        self.cf_downloadable_project(project).await?;
        let client = self.cf_file(project, file).await?;
        if client["isServerPack"] == true {
            return Err(SoftwareError::Invalid);
        }
        let server_id = client["serverPackFileId"]
            .as_u64()
            .filter(|id| *id > 0)
            .ok_or(SoftwareError::DownloadUnavailable)?;
        let server = self.cf_file(project, server_id).await?;
        if server["isServerPack"] != true {
            return Err(SoftwareError::DownloadUnavailable);
        }
        let archive = directory.join("server-pack.zip");
        self.cf_download(project, &server, &archive).await?;
        let source = archive.clone();
        let dir = directory.to_owned();
        let extraction_lease = lease.clone();
        let extraction_progress = self.progress.clone();
        let checksum = tokio::task::spawn_blocking(move || -> Result<String, SoftwareError> {
            let _lease = extraction_lease;
            verify_and_extract(&source, &dir, &extraction_progress)
        })
        .await
        .map_err(|_| SoftwareError::Filesystem)??;
        tokio::fs::remove_file(&archive)
            .await
            .map_err(|_| SoftwareError::Filesystem)?;
        let root = directory.join("pack");
        let metadata_mc = client["gameVersions"]
            .as_array()
            .and_then(|v| {
                v.iter()
                    .filter_map(Value::as_str)
                    .filter(|v| {
                        v.split('.').count() >= 3 && v.split('.').all(|s| s.parse::<u32>().is_ok())
                    })
                    .max_by_key(|v| {
                        v.split('.')
                            .filter_map(|s| s.parse::<u32>().ok())
                            .collect::<Vec<_>>()
                    })
            })
            .map(str::to_owned);
        let mut plan = crate::pack::inspect(&root, options, metadata_mc.as_deref(), None);
        if matches!(plan, Err(SoftwareError::PackUnsupported))
            && !root.join("mmc-pack.json").exists()
        {
            // Some server packs deliberately omit the loader; the client manifest pins it.
            let client_zip = directory.join("client-manifest.zip");
            self.cf_download(project, &client, &client_zip).await?;
            let manifest_lease = lease.clone();
            let manifest = tokio::task::spawn_blocking(move || -> Result<Value, SoftwareError> {
                let _lease = manifest_lease;
                let mut zip = zip::ZipArchive::new(
                    std::fs::File::open(&client_zip).map_err(|_| SoftwareError::Filesystem)?,
                )
                .map_err(|_| SoftwareError::Download)?;
                let entry = zip
                    .by_name("manifest.json")
                    .map_err(|_| SoftwareError::PackUnsupported)?;
                if entry.size() > 1024 * 1024 {
                    return Err(SoftwareError::PackUnsupported);
                }
                serde_json::from_reader(entry.take(1024 * 1024 + 1))
                    .map_err(|_| SoftwareError::PackUnsupported)
            })
            .await
            .map_err(|_| SoftwareError::Filesystem)??;
            plan = crate::pack::inspect(&root, options, metadata_mc.as_deref(), Some(&manifest));
        }
        let plan = plan?;
        let installer = if let Some((url, path, args)) = &plan.install {
            if !root.join(path).is_file() {
                let checksum = self
                    .curseforge_http
                    .text(
                        url::Url::parse(&format!("{url}.sha1"))
                            .map_err(|_| SoftwareError::Upstream)?,
                    )
                    .await
                    .map_err(|_| SoftwareError::Upstream)?;
                let checksum = checksum
                    .split_whitespace()
                    .next()
                    .ok_or(SoftwareError::Upstream)?;
                self.curseforge_http
                    .installer_artifact(
                        url::Url::parse(url).map_err(|_| SoftwareError::Upstream)?,
                        &root.join(path),
                        checksum,
                    )
                    .await
                    .map_err(|_| SoftwareError::Download)?;
            }
            Some(InstallerCommand {
                path: path.clone(),
                args: args.clone(),
                java_major: plan.java,
            })
        } else {
            None
        };
        Ok(PreparedSoftware {
            launch: Launch {
                path: plan.profile.path.clone(),
                java_major: plan.java,
                version: plan.mc,
                build: Some(file.to_string()),
                checksum,
                profile: Some(LaunchOptions {
                    mode: plan.profile.mode,
                    jvm_args: plan.profile.jvm_args,
                    args: plan.profile.args,
                }),
                loader: plan.loader,
            },
            installer,
            instance_files: true,
        })
    }
}

fn verify_and_extract(
    source: &Path,
    dir: &Path,
    progress: &chunkyard_core::progress::ProgressReporter,
) -> Result<String, SoftwareError> {
    let mut file = std::fs::File::open(source).map_err(|_| SoftwareError::Filesystem)?;
    let mut hash = Sha256::new();
    let total = file
        .metadata()
        .map_err(|_| SoftwareError::Filesystem)?
        .len();
    let mut done = 0;
    progress.bytes(
        chunkyard_core::progress::Stage::Verify,
        Some(0),
        Some(total),
    );
    let mut buffer = vec![0; 128 * 1024];
    loop {
        let n = file
            .read(&mut buffer)
            .map_err(|_| SoftwareError::Filesystem)?;
        if n == 0 {
            break;
        }
        hash.update(&buffer[..n]);
        done += n as u64;
        progress.bytes(
            chunkyard_core::progress::Stage::Verify,
            Some(done),
            Some(total),
        );
    }
    progress.stage(chunkyard_core::progress::Stage::Extract);
    chunkyard_fs::extract_server_pack(source, &dir.join("unpacked"))
        .map_err(|_| SoftwareError::Download)?;
    crate::pack::flatten(&dir.join("unpacked"), &dir.join("pack"))?;
    Ok(format!("{:x}", hash.finalize()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn preparation_hashes_archive_bytes_and_flattens_the_extracted_wrapper()
    -> Result<(), Box<dyn std::error::Error>> {
        let dir = tempfile::tempdir()?;
        let source = dir.path().join("server-pack.zip");
        let mut archive = zip::ZipWriter::new(std::fs::File::create(&source)?);
        archive.start_file(
            "Wrapped Server/mods/fixture.jar",
            zip::write::SimpleFileOptions::default(),
        )?;
        archive.write_all(b"fixture mod")?;
        archive.finish()?;
        let expected = format!("{:x}", Sha256::digest(std::fs::read(&source)?));
        let checksum = verify_and_extract(&source, dir.path(), &Default::default())?;
        assert_eq!(checksum, expected);
        assert_eq!(
            std::fs::read(dir.path().join("pack/mods/fixture.jar"))?,
            b"fixture mod"
        );
        assert!(!dir.path().join("unpacked").exists());
        Ok(())
    }
}
