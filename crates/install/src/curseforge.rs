//! CurseForge catalog requests, distribution policy and authorized downloads.
mod models;
mod preparation;
use super::Installers;
use chunkyard_core::software::*;
pub(super) use models::project_view;
use models::{cached_project, logo_source};
use serde_json::{Value, json};
use std::path::Path;

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
}

#[cfg(test)]
mod tests {
    use super::*;
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
