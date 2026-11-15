use super::Installers;
use chunkyard_core::software::*;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{io::Read, path::Path};

pub(super) fn project_view(project: &Value) -> Value {
    let id = project["id"].as_u64().unwrap_or(0);
    let website = project["links"]["websiteUrl"].as_str().and_then(|value| {
        let url = url::Url::parse(value).ok()?;
        (url.scheme() == "https"
            && url.username().is_empty()
            && url.password().is_none()
            && matches!(
                url.host_str(),
                Some("curseforge.com" | "www.curseforge.com")
            )
            && url.port_or_known_default() == Some(443))
        .then_some(value)
    });
    let logo = logo_source(project).map(|_| format!("/api/v1/modpacks/curseforge/{id}/logo"));
    json!({"id":id,"name":project["name"],"summary":project["summary"],
        "websiteUrl":website,"logoUrl":logo,"downloads":project["downloadCount"]})
}
fn logo_source(project: &Value) -> Option<&str> {
    project["logo"]["thumbnailUrl"]
        .as_str()
        .filter(|s| !s.is_empty())
        .or_else(|| project["logo"]["url"].as_str().filter(|s| !s.is_empty()))
}

// Retain only display/download-policy fields; upstream projects include large file inventories.
fn cached_project(project: &Value) -> Value {
    let text = |value: &Value, limit| {
        value
            .as_str()
            .map(|text| text.chars().take(limit).collect::<String>())
    };
    json!({"id":project["id"],"gameId":project["gameId"],"classId":project["classId"],
        "allowModDistribution":project["allowModDistribution"],"downloadCount":project["downloadCount"],
        "name":text(&project["name"],256),"summary":text(&project["summary"],2000),
        "links":{"websiteUrl":text(&project["links"]["websiteUrl"],2048)},
        "logo":{"url":text(&project["logo"]["url"],2048),"thumbnailUrl":text(&project["logo"]["thumbnailUrl"],2048)}})
}

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
        let mut cache = self.projects.lock().await;
        if cache.len() > 98 {
            cache.clear();
        }
        for project in response["data"]
            .as_array()
            .ok_or(SoftwareError::Upstream)?
            .iter()
            .take(30)
        {
            if project["gameId"] == 432
                && project["classId"] == 4471
                && let Some(id) = project["id"].as_u64().filter(|id| *id > 0)
            {
                cache.insert(id, (std::time::Instant::now(), cached_project(project)));
            }
        }
        drop(cache);
        let items = response["data"]
            .as_array()
            .ok_or(SoftwareError::Upstream)?
            .iter()
            .take(30)
            .filter(|p| p["gameId"] == 432 && p["classId"] == 4471)
            .map(project_view)
            .collect::<Vec<_>>();
        Ok(
            json!({"items":items,"pagination":{"index":index,"pageSize":30,"totalCount":response["pagination"]["totalCount"]}}),
        )
    }
    pub(super) async fn cf_project(&self, id: u64) -> Result<Value, SoftwareError> {
        if id == 0 {
            return Err(SoftwareError::Invalid);
        }
        let mut cache = self.projects.lock().await;
        if let Some((at, project)) = cache.get(&id)
            && at.elapsed() < std::time::Duration::from_secs(3600)
        {
            return Ok(project.clone());
        }
        let p = cached_project(&self.cf_json(&format!("mods/{id}")).await?["data"]);
        if p["id"] != id || p["gameId"] != 432 || p["classId"] != 4471 {
            return Err(SoftwareError::Invalid);
        }
        if cache.len() >= 128 {
            cache.clear();
        }
        cache.insert(id, (std::time::Instant::now(), p.clone()));
        Ok(p)
    }
    async fn cf_downloadable_project(&self, id: u64) -> Result<(), SoftwareError> {
        if self.cf_project(id).await?["allowModDistribution"] == false {
            return Err(SoftwareError::DownloadUnavailable);
        }
        Ok(())
    }
    pub(super) async fn cf_logo(&self, id: u64) -> Result<Vec<u8>, SoftwareError> {
        let _permit = self
            .logo_slots
            .acquire()
            .await
            .map_err(|_| SoftwareError::Upstream)?;
        let cache = self.logos.lock().await;
        if let Some((at, bytes)) = cache.get(&id)
            && at.elapsed() < std::time::Duration::from_secs(3600)
        {
            return Ok(bytes.clone());
        }
        drop(cache);
        let project = self.cf_project(id).await?;
        let url = logo_source(&project).ok_or(SoftwareError::DownloadUnavailable)?;
        let url = url::Url::parse(url).map_err(|_| SoftwareError::Upstream)?;
        let bytes = tokio::time::timeout(
            std::time::Duration::from_secs(30),
            self.logo_http.icon_bytes(url),
        )
        .await
        .map_err(|_| SoftwareError::Upstream)?
        .map_err(|_| SoftwareError::Upstream)?;
        let bytes = chunkyard_download::decode_icon(bytes)
            .await
            .map_err(|_| SoftwareError::Upstream)?;
        let mut cache = self.logos.lock().await;
        if cache.len() >= 64 {
            cache.clear();
        }
        cache.insert(id, (std::time::Instant::now(), bytes.clone()));
        Ok(bytes)
    }
    pub(super) async fn cf_files(&self, id: u64) -> Result<Value, SoftwareError> {
        self.cf_downloadable_project(id).await?;
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
        if matches!(&result,Err(chunkyard_download::DownloadError::Http(e)) if e.status().is_some_and(|s|s.as_u16()==404))
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
            let mut file = std::fs::File::open(&source).map_err(|_| SoftwareError::Filesystem)?;
            let mut hash = Sha256::new();
            let total = file
                .metadata()
                .map_err(|_| SoftwareError::Filesystem)?
                .len();
            let mut done = 0;
            extraction_progress.bytes(
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
                extraction_progress.bytes(
                    chunkyard_core::progress::Stage::Verify,
                    Some(done),
                    Some(total),
                );
            }
            extraction_progress.stage(chunkyard_core::progress::Stage::Extract);
            chunkyard_fs::extract_server_pack(&source, &dir.join("unpacked"))
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

#[cfg(test)]
mod display_tests {
    use super::*;
    #[test]
    fn display_metadata_uses_local_logos_and_discards_unneeded_or_unsafe_fields() {
        let source = json!({"id":925200,"gameId":432,"classId":4471,"name":"ATM 10",
            "summary":"A pack","downloadCount":123,"allowModDistribution":false,
            "links":{"websiteUrl":"https://evil.test/pack"},
            "logo":{"thumbnailUrl":"","url":"https://media.forgecdn.net/avatars/logo.png"},
            "latestFiles":["large file inventory"]});
        let cached = cached_project(&source);
        assert!(cached.get("latestFiles").is_none());
        assert_eq!(cached["allowModDistribution"], false);
        let view = project_view(&cached);
        assert_eq!(view["logoUrl"], "/api/v1/modpacks/curseforge/925200/logo");
        assert!(view["websiteUrl"].is_null());
        assert_eq!(
            logo_source(&cached),
            Some("https://media.forgecdn.net/avatars/logo.png")
        );
    }
    #[tokio::test]
    async fn public_metadata_does_not_bypass_download_distribution_policy()
    -> Result<(), Box<dyn std::error::Error>> {
        let installers = Installers::new()?;
        installers.projects.lock().await.insert(
            1,
            (
                std::time::Instant::now(),
                json!({"id":1,"name":"Public pack","allowModDistribution":false}),
            ),
        );
        assert_eq!(installers.cf_project(1).await?["name"], "Public pack");
        assert!(matches!(
            installers.cf_downloadable_project(1).await,
            Err(SoftwareError::DownloadUnavailable)
        ));
        Ok(())
    }
}
