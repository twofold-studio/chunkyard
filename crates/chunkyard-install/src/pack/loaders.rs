//! Literal loader identification and bounded preinstalled-library discovery.
use chunkyard_core::software::*;
use serde_json::Value;
use std::path::Path;

pub(super) fn manifest(m: &Value) -> Option<(String, Loader)> {
    if let (Some(mc), Some(kind), Some(version)) = (
        m["minecraftVersion"].as_str(),
        m["modloader"].as_str(),
        m["modloaderVersion"].as_str(),
    ) {
        return Some((
            mc.into(),
            Loader {
                r#type: kind_parse(kind)?,
                version: version.into(),
            },
        ));
    }
    let mc = m["minecraft"]["version"].as_str()?;
    let loaders = m["minecraft"]["modLoaders"].as_array()?;
    let loader = loaders
        .iter()
        .find(|l| l["primary"] == true)
        .or_else(|| loaders.first())?["id"]
        .as_str()?;
    let (kind, version) = loader.split_once('-')?;
    Some((
        mc.into(),
        Loader {
            r#type: kind_parse(kind)?,
            version: version.into(),
        },
    ))
}
pub(super) fn kind_parse(s: &str) -> Option<LoaderType> {
    match s.to_ascii_lowercase().as_str() {
        "forge" => Some(LoaderType::Forge),
        "neoforge" => Some(LoaderType::NeoForge),
        "fabric" => Some(LoaderType::Fabric),
        _ => None,
    }
}
pub(super) fn forge_name(name: &str) -> Option<(String, Loader)> {
    let base = name
        .strip_prefix("forge-")?
        .strip_suffix("-installer.jar")?;
    let (mc, version) = base.split_once('-')?;
    Some((
        mc.into(),
        Loader {
            r#type: LoaderType::Forge,
            version: version.into(),
        },
    ))
}
pub(super) fn preinstalled(
    root: &Path,
    mc: &mut String,
    loader: &mut Option<Loader>,
) -> Result<(), SoftwareError> {
    // Preinstalled modern Forge packs can have no bootstrap settings at all.
    if loader.is_none() {
        for (folder, kind) in [
            ("libraries/net/minecraftforge/forge", LoaderType::Forge),
            ("libraries/net/neoforged/neoforge", LoaderType::NeoForge),
        ] {
            if let Ok(entries) = std::fs::read_dir(root.join(folder)) {
                for entry in entries.take(100) {
                    let entry = entry.map_err(|_| SoftwareError::Filesystem)?;
                    let version = entry.file_name().to_string_lossy().into_owned();
                    if entry.path().join("unix_args.txt").is_file() {
                        if kind == LoaderType::Forge {
                            if let Some((m, v)) = version.split_once('-') {
                                *mc = m.into();
                                *loader = Some(Loader {
                                    r#type: kind,
                                    version: v.into(),
                                });
                            }
                        } else {
                            *loader = Some(Loader {
                                r#type: kind,
                                version,
                            });
                        }
                        break;
                    }
                }
            }
        }
    }
    Ok(())
}
