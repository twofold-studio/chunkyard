//! Gather bounded literal metadata, then resolve explicit overrides in priority order.
use super::loaders::{forge_name, kind_parse, manifest, preinstalled};
use chunkyard_core::software::*;
use serde_json::Value;
use std::{collections::BTreeMap, io::Read, path::Path};

fn small(path: &Path) -> Option<String> {
    let metadata = std::fs::symlink_metadata(path).ok()?;
    if !metadata.is_file() || metadata.len() > 1024 * 1024 {
        return None;
    }
    let mut text = String::new();
    std::fs::File::open(path)
        .ok()?
        .take(1024 * 1024 + 1)
        .read_to_string(&mut text)
        .ok()?;
    Some(text)
}
fn literal(text: &str, values: &mut BTreeMap<String, String>) {
    for line in text.lines() {
        let line = line.trim().strip_prefix("export ").unwrap_or(line.trim());
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        if !key.bytes().all(|b| b.is_ascii_uppercase() || b == b'_') {
            continue;
        }
        let value = value.trim().trim_matches(['\'', '"']);
        if value.len() <= 128 && !value.contains(['$', '`', ';', '\n', '\r']) {
            values.entry(key.into()).or_insert_with(|| value.into());
        }
    }
}
pub(super) struct Metadata {
    pub values: BTreeMap<String, String>,
    from_manifest: Option<(String, Loader)>,
    from_jar: Option<(String, Loader)>,
}
impl Metadata {
    pub fn gather(root: &Path, client: Option<&Value>) -> Result<Self, SoftwareError> {
        let mut values = BTreeMap::new();
        for name in [
            "variables.txt",
            "settings.sh",
            "settings.cfg",
            "startserver.sh",
            "ServerStart.sh",
            "start.sh",
            "vh-setup-unix.sh",
        ] {
            if let Some(text) = small(&root.join(name)) {
                literal(&text, &mut values);
            }
        }
        let local_manifest =
            small(&root.join("manifest.json")).and_then(|s| serde_json::from_str::<Value>(&s).ok());
        let from_manifest = local_manifest
            .as_ref()
            .and_then(manifest)
            .or_else(|| client.and_then(manifest));
        let mut names = std::fs::read_dir(root)
            .map_err(|_| SoftwareError::Filesystem)?
            .filter_map(Result::ok)
            .filter_map(|e| e.file_name().to_str().map(str::to_owned))
            .collect::<Vec<_>>();
        names.sort();
        let from_jar = names
            .iter()
            .find_map(|n| forge_name(n))
            .or_else(|| values.get("INSTALL_JAR").and_then(|n| forge_name(n)));
        Ok(Self {
            values,
            from_manifest,
            from_jar,
        })
    }
    pub fn resolve(
        &self,
        root: &Path,
        options: &InstallOptions,
        metadata_mc: Option<&str>,
    ) -> Result<(String, Option<Loader>), SoftwareError> {
        let Self {
            values,
            from_manifest,
            from_jar,
        } = self;
        let mut mc = options
            .minecraft_version
            .clone()
            .or_else(|| values.get("MINECRAFT_VERSION").cloned())
            .or_else(|| from_manifest.as_ref().map(|x| x.0.clone()))
            .or_else(|| from_jar.as_ref().map(|x| x.0.clone()))
            .or_else(|| metadata_mc.map(str::to_owned))
            .ok_or(SoftwareError::PackUnsupported)?;
        component(&mc)?;
        let inferred = values
            .get("MODLOADER")
            .and_then(|s| kind_parse(s))
            .zip(values.get("MODLOADER_VERSION").cloned())
            .map(|(r#type, version)| Loader { r#type, version })
            .or_else(|| {
                values.get("NEOFORGE_VERSION").map(|v| Loader {
                    r#type: LoaderType::NeoForge,
                    version: v.clone(),
                })
            })
            .or_else(|| {
                values.get("FORGE_VERSION").map(|v| Loader {
                    r#type: LoaderType::Forge,
                    version: v.clone(),
                })
            })
            .or_else(|| from_manifest.as_ref().map(|x| x.1.clone()))
            .or_else(|| from_jar.as_ref().map(|x| x.1.clone()));
        let mut loader = options
            .loader
            .or_else(|| inferred.as_ref().map(|l| l.r#type))
            .zip(
                options
                    .loader_version
                    .clone()
                    .or_else(|| inferred.map(|l| l.version)),
            )
            .map(|(r#type, version)| Loader { r#type, version });
        preinstalled(root, &mut mc, &mut loader)?;
        Ok((mc, loader))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn literal_settings_and_local_manifest_keep_precedence_over_fallbacks()
    -> Result<(), Box<dyn std::error::Error>> {
        let root = tempfile::tempdir()?;
        std::fs::write(
            root.path().join("variables.txt"),
            "MINECRAFT_VERSION=1.20.1\n",
        )?;
        std::fs::write(
            root.path().join("settings.sh"),
            "MINECRAFT_VERSION=1.21.1\n",
        )?;
        std::fs::write(
            root.path().join("manifest.json"),
            serde_json::to_vec(&json!({
                "minecraftVersion":"1.19.2", "modloader":"Forge", "modloaderVersion":"43.4.0"
            }))?,
        )?;
        std::fs::write(root.path().join("forge-1.18.2-40.3.0-installer.jar"), [])?;
        let client =
            json!({"minecraftVersion":"1.16.5", "modloader":"Fabric", "modloaderVersion":"0.16.0"});
        let metadata = Metadata::gather(root.path(), Some(&client))?;
        let (mc, loader) = metadata.resolve(root.path(), &Default::default(), Some("1.12.2"))?;
        assert_eq!(mc, "1.20.1");
        let loader = loader.ok_or("missing loader")?;
        assert_eq!(loader.r#type, LoaderType::Forge);
        assert_eq!(loader.version, "43.4.0");
        Ok(())
    }
}
