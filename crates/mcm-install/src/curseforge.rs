use super::Installers;
use mcm_core::software::*;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{io::Read, path::Path};

impl Installers {
    async fn cf_json(&self, path: &str) -> Result<Value, SoftwareError> {
        let key = self
            .curseforge_key
            .as_deref()
            .ok_or(SoftwareError::DownloadUnavailable)?;
        let url = url::Url::parse(&format!("https://api.curseforge.com/v1/{path}"))
            .map_err(|_| SoftwareError::Invalid)?;
        tokio::time::timeout(
            std::time::Duration::from_secs(30),
            self.curseforge_http.curseforge_json(url, key),
        )
        .await
        .map_err(|_| SoftwareError::Upstream)?
        .map_err(|_| SoftwareError::Upstream)
    }
    pub(super) async fn cf_search(&self, query: &str, index: u32) -> Result<Value, SoftwareError> {
        if query.len() > 120 || query.chars().any(char::is_control) || index > 9900 {
            return Err(SoftwareError::Invalid);
        }
        let params = {
            let mut params = url::form_urlencoded::Serializer::new(String::new());
            params
                .append_pair("gameId", "432")
                .append_pair("classId", "4471")
                .append_pair("searchFilter", query)
                .append_pair("sortField", "2")
                .append_pair("sortOrder", "desc")
                .append_pair("pageSize", "30")
                .append_pair("index", &index.to_string());
            params.finish()
        };
        let response = self.cf_json(&format!("mods/search?{params}")).await?;
        let items=response["data"].as_array().ok_or(SoftwareError::Upstream)?.iter().map(|p|json!({"id":p["id"],"name":p["name"],"summary":p["summary"],"websiteUrl":p["links"]["websiteUrl"],"logoUrl":p["logo"]["url"],"downloads":p["downloadCount"]})).collect::<Vec<_>>();
        Ok(
            json!({"items":items,"pagination":{"index":index,"pageSize":30,"totalCount":response["pagination"]["totalCount"]}}),
        )
    }
    async fn cf_project(&self, id: u64) -> Result<Value, SoftwareError> {
        if id == 0 {
            return Err(SoftwareError::Invalid);
        }
        let p = self.cf_json(&format!("mods/{id}")).await?["data"].clone();
        if p["id"] != id || p["gameId"] != 432 || p["classId"] != 4471 {
            return Err(SoftwareError::Invalid);
        }
        if p["allowModDistribution"] == false {
            return Err(SoftwareError::DownloadUnavailable);
        }
        Ok(p)
    }
    pub(super) async fn cf_files(&self, id: u64) -> Result<Value, SoftwareError> {
        self.cf_project(id).await?;
        let mut items = Vec::new();
        for page in 0..4 {
            let response = self
                .cf_json(&format!("mods/{id}/files?pageSize=50&index={}", page * 50))
                .await?;
            let files = response["data"].as_array().ok_or(SoftwareError::Upstream)?;
            for f in files {
                if f["modId"] == id
                    && f["isServerPack"] != true
                    && f["serverPackFileId"].as_u64().is_some_and(|n| n > 0)
                {
                    items.push(json!({"id":f["id"],"name":f["displayName"],"gameVersions":f["gameVersions"],"serverPackFileId":f["serverPackFileId"]}));
                }
            }
            if files.len() < 50 {
                break;
            }
        }
        Ok(json!({"items":items}))
    }
    async fn cf_file(&self, project: u64, file: u64) -> Result<Value, SoftwareError> {
        if file == 0 {
            return Err(SoftwareError::Invalid);
        }
        let f = self
            .cf_json(&format!("mods/{project}/files/{file}"))
            .await?["data"]
            .clone();
        if f["id"] != file || f["modId"] != project || f["gameId"] != 432 {
            return Err(SoftwareError::Invalid);
        }
        Ok(f)
    }
    async fn cf_download(
        &self,
        project: u64,
        file: &Value,
        path: &Path,
    ) -> Result<(), SoftwareError> {
        let url = match file["downloadUrl"].as_str().filter(|s| !s.is_empty()) {
            Some(url) => url.to_owned(),
            None => self
                .cf_json(&format!(
                    "mods/{project}/files/{}/download-url",
                    file["id"].as_u64().ok_or(SoftwareError::Upstream)?
                ))
                .await?["data"]
                .as_str()
                .filter(|s| !s.is_empty())
                .ok_or(SoftwareError::DownloadUnavailable)?
                .to_owned(),
        };
        let checksum = file["hashes"]
            .as_array()
            .and_then(|h| h.iter().find(|h| h["algo"] == 1))
            .and_then(|h| h["value"].as_str())
            .ok_or(SoftwareError::Upstream)?;
        let size = file["fileLength"].as_u64().ok_or(SoftwareError::Upstream)?;
        let mut parsed = url::Url::parse(&url).map_err(|_| SoftwareError::Download)?;
        if !matches!(
            parsed.host_str(),
            Some("edge.forgecdn.net" | "mediafilez.forgecdn.net" | "mediafiles.forgecdn.net")
        ) {
            return Err(SoftwareError::Download);
        }
        let result = self
            .curseforge_http
            .pack_artifact(parsed.clone(), path, size, checksum)
            .await;
        // CurseForge still advertises edge URLs whose objects are served from its other official CDN.
        // Only retry an explicit 404 for an already-authorized URL, never a missing/disabled URL.
        if matches!(&result,Err(mcm_download::DownloadError::Http(e)) if e.status().is_some_and(|s|s.as_u16()==404))
            && parsed.host_str() == Some("edge.forgecdn.net")
        {
            parsed
                .set_host(Some("mediafilez.forgecdn.net"))
                .map_err(|_| SoftwareError::Download)?;
            self.curseforge_http
                .pack_artifact(parsed, path, size, checksum)
                .await
                .map_err(|_| SoftwareError::Download)
        } else {
            result.map_err(|_| SoftwareError::Download)
        }
    }
    pub(super) async fn cf_prepare(
        &self,
        project: u64,
        file: u64,
        directory: &Path,
        options: &InstallOptions,
        lease: std::sync::Arc<dyn Send + Sync>,
    ) -> Result<PreparedSoftware, SoftwareError> {
        self.cf_project(project).await?;
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
        let checksum = tokio::task::spawn_blocking(move || -> Result<String, SoftwareError> {
            let _lease = extraction_lease;
            let mut file = std::fs::File::open(&source).map_err(|_| SoftwareError::Filesystem)?;
            let mut hash = Sha256::new();
            let mut buffer = vec![0; 128 * 1024];
            loop {
                let n = file
                    .read(&mut buffer)
                    .map_err(|_| SoftwareError::Filesystem)?;
                if n == 0 {
                    break;
                }
                hash.update(&buffer[..n]);
            }
            mcm_fs::extract_server_pack(&source, &dir.join("unpacked"))
                .map_err(|_| SoftwareError::Download)?;
            super::pack::flatten(&dir.join("unpacked"), &dir.join("pack"))?;
            Ok(format!("{:x}", hash.finalize()))
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
        let mut plan = super::pack::inspect(&root, options, metadata_mc.as_deref(), None);
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
            plan = super::pack::inspect(&root, options, metadata_mc.as_deref(), Some(&manifest));
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
