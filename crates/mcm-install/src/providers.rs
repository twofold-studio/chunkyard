use super::*;
use async_trait::async_trait;
use mcm_core::software::{Launch, Software, SoftwareService, component};
use serde_json::json;
const MANIFEST: &str = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";
const PAPER: &str = "https://fill.papermc.io/v3/projects/paper";
#[async_trait]
impl SoftwareService for Installers {
    fn catalog(&self) -> Value {
        let enabled = self.curseforge_key.is_some();
        json!({"items":[{"id":"vanilla","name":"Vanilla","available":true,"reason":null},{"id":"paper","name":"Paper","available":true,"reason":null},{"id":"curseforge","name":"CurseForge modpack","available":enabled,"reason":if enabled{None}else{Some("Configure CHUNKYARD_CURSEFORGE__API_KEY on the manager.")}},{"id":"custom","name":"Custom JAR","available":true,"reason":null}]})
    }
    async fn search_modpacks(&self, query: &str, index: u32) -> Result<Value, SoftwareError> {
        self.cf_search(query, index).await
    }
    async fn modpack_files(&self, id: u64) -> Result<Value, SoftwareError> {
        self.cf_files(id).await
    }
    async fn prepare_plan(
        &self,
        software: &Software,
        directory: &Path,
        options: &mcm_core::software::InstallOptions,
        lease: std::sync::Arc<dyn Send + Sync>,
    ) -> Result<mcm_core::software::PreparedSoftware, SoftwareError> {
        if let Some(profile) = &options.launch {
            profile.validate()?;
        }
        if let Software::CurseForge {
            project_id,
            file_id,
        } = software
        {
            self.cf_prepare(*project_id, *file_id, directory, options, lease)
                .await
        } else {
            Ok(mcm_core::software::PreparedSoftware {
                launch: self.prepare(software, directory).await?,
                installer: None,
                instance_files: false,
            })
        }
    }
    async fn versions(&self, kind: &str) -> Result<Value, SoftwareError> {
        let mut ids: Vec<String> = match kind {
            "vanilla" => self.json(MANIFEST).await?["versions"]
                .as_array()
                .ok_or(SoftwareError::Upstream)?
                .iter()
                .filter(|v| v["type"] == "release")
                .filter_map(|v| v["id"].as_str().map(str::to_owned))
                .collect(),
            "paper" => self.json(PAPER).await?["versions"]
                .as_object()
                .ok_or(SoftwareError::Upstream)?
                .values()
                .filter_map(Value::as_array)
                .flatten()
                .filter_map(Value::as_str)
                .filter(|id| release(id))
                .map(str::to_owned)
                .collect(),
            _ => return Err(SoftwareError::Invalid),
        };
        // Natural version order, independent of provider map/object ordering.
        ids.sort_by_cached_key(|id| std::cmp::Reverse(version_key(id)));
        ids.dedup();
        Ok(json!({"items":ids.iter().map(|id|json!({"id":id,"stable":true})).collect::<Vec<_>>()}))
    }
    async fn builds(&self, kind: &str, version: &str) -> Result<Value, SoftwareError> {
        if kind != "paper" {
            return Err(SoftwareError::Invalid);
        }
        component(version)?;
        if !release(version) {
            return Err(SoftwareError::Invalid);
        }
        let metadata = self
            .json(&format!("{PAPER}/versions/{version}/builds"))
            .await?;
        let mut items: Vec<Value> = metadata
            .as_array()
            .ok_or(SoftwareError::Upstream)?
            .iter()
            .filter(|v| v["channel"] == "STABLE")
            .filter_map(|v| v["id"].as_u64())
            .map(|id| json!({"id":id.to_string(),"stable":true}))
            .collect();
        items.sort_by_key(|v| {
            std::cmp::Reverse(
                v["id"]
                    .as_str()
                    .and_then(|id| id.parse::<u64>().ok())
                    .unwrap_or(0),
            )
        });
        Ok(json!({"items":items}))
    }
    async fn prepare(
        &self,
        software: &Software,
        directory: &Path,
    ) -> Result<Launch, SoftwareError> {
        software.validate()?;
        let version = software.version();
        let vanilla = self.vanilla(version).await?;
        let java = vanilla["javaVersion"]["majorVersion"].as_u64().unwrap_or(8);
        let mut java: u16 = java.try_into().map_err(|_| SoftwareError::Upstream)?;
        if !(8..=99).contains(&java) {
            return Err(SoftwareError::Upstream);
        }
        let (url, size, checksum, build) = match software {
            Software::CurseForge { .. } => return Err(SoftwareError::Invalid),
            Software::Vanilla { .. } => {
                let file = &vanilla["downloads"]["server"];
                (
                    string(file, "url")?.to_owned(),
                    file["size"].as_u64().ok_or(SoftwareError::Upstream)?,
                    string(file, "sha1")?.to_owned(),
                    None,
                )
            }
            Software::Paper { build, .. } => {
                java = paper_java(version);
                let metadata = self
                    .json(&format!("{PAPER}/versions/{version}/builds"))
                    .await?;
                let selected = select_paper(&metadata, build.as_deref())?;
                let download = &selected["downloads"]["server:default"];
                (
                    string(download, "url")?.to_owned(),
                    download["size"].as_u64().ok_or(SoftwareError::Upstream)?,
                    string(&download["checksums"], "sha256")?.to_owned(),
                    Some(
                        selected["id"]
                            .as_u64()
                            .ok_or(SoftwareError::Upstream)?
                            .to_string(),
                    ),
                )
            }
        };
        self.artifact(&url, &directory.join("server.jar"), size, &checksum)
            .await?;
        Ok(Launch {
            profile: None,
            loader: None,
            path: "server.jar".into(),
            version: version.into(),
            build,
            java_major: java,
            checksum,
        })
    }
}
impl Installers {
    async fn vanilla(&self, version: &str) -> Result<Value, SoftwareError> {
        let manifest = self.json(MANIFEST).await?;
        let entry = manifest["versions"]
            .as_array()
            .ok_or(SoftwareError::Upstream)?
            .iter()
            .find(|v| v["id"] == version && v["type"] == "release")
            .ok_or(SoftwareError::Invalid)?;
        self.json(string(entry, "url")?).await
    }
}
// Paper's published recommended JVM table differs from Vanilla's metadata.
fn paper_java(version: &str) -> u16 {
    let parts = version_key(version);
    match parts.as_slice() {
        [major, ..] if *major >= 26 => 25,
        [1, minor, ..] if *minor >= 20 => 21,
        [1, minor, ..] if *minor >= 17 => 17,
        [1, 16, patch, ..] if *patch >= 5 => 16,
        [1, minor, ..] if *minor >= 12 => 11,
        _ => 8,
    }
}
fn release(version: &str) -> bool {
    !version.is_empty()
        && version
            .split('.')
            .all(|part| !part.is_empty() && part.bytes().all(|b| b.is_ascii_digit()))
}
fn version_key(version: &str) -> Vec<u32> {
    version.split('.').filter_map(|v| v.parse().ok()).collect()
}
fn select_paper<'a>(metadata: &'a Value, build: Option<&str>) -> Result<&'a Value, SoftwareError> {
    metadata
        .as_array()
        .ok_or(SoftwareError::Upstream)?
        .iter()
        .filter(|v| v["channel"] == "STABLE")
        .filter(|v| build.is_none_or(|b| v["id"].as_u64().is_some_and(|id| id.to_string() == b)))
        .max_by_key(|v| v["id"].as_u64().unwrap_or(0))
        .ok_or(SoftwareError::Invalid)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn selects_latest_stable_build_and_honors_pins() -> Result<(), SoftwareError> {
        let data = json!([{"id":3,"channel":"EXPERIMENTAL"},{"id":1,"channel":"STABLE"},{"id":2,"channel":"STABLE"}]);
        assert_eq!(select_paper(&data, None)?["id"], 2);
        assert_eq!(select_paper(&data, Some("1"))?["id"], 1);
        assert!(select_paper(&data, Some("3")).is_err());
        Ok(())
    }
    #[test]
    fn paper_uses_its_documented_jvm_recommendations() {
        for (version, major) in [
            ("1.8.8", 8),
            ("1.12.2", 11),
            ("1.16.4", 11),
            ("1.16.5", 16),
            ("1.17.1", 17),
            ("1.19.4", 17),
            ("1.20.1", 21),
            ("1.21.11", 21),
            ("26.1.2", 25),
        ] {
            assert_eq!(paper_java(version), major, "{version}");
        }
    }
    #[test]
    fn stable_versions_exclude_snapshots_and_pre_releases() {
        for version in ["1.21-pre1", "26.3-rc-3", "24w10a", "../1.21", "1..21"] {
            assert!(!release(version))
        }
        assert!(release("1.21.4"));
        assert!(version_key("1.21.10") > version_key("1.21.9"));
    }
}
