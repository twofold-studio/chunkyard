//! Read literal pack metadata, never evaluate a publisher's shell or PowerShell.
use chunkyard_core::software::*;
use serde_json::Value;
use std::{collections::BTreeMap, io::Read, path::Path};
pub(super) struct PackPlan {
    pub mc: String,
    pub java: u16,
    pub loader: Option<Loader>,
    pub profile: LaunchProfile,
    pub install: Option<(String, String, Vec<String>)>,
}
pub(super) fn flatten(source: &Path, destination: &Path) -> Result<(), SoftwareError> {
    let entries = std::fs::read_dir(source)
        .map_err(|_| SoftwareError::Filesystem)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| SoftwareError::Filesystem)?;
    if entries.len() == 1
        && entries[0]
            .file_type()
            .map_err(|_| SoftwareError::Filesystem)?
            .is_dir()
    {
        std::fs::rename(entries[0].path(), destination).map_err(|_| SoftwareError::Filesystem)?;
        std::fs::remove_dir(source).map_err(|_| SoftwareError::Filesystem)?;
    } else {
        std::fs::rename(source, destination).map_err(|_| SoftwareError::Filesystem)?;
    }
    Ok(())
}
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
fn manifest(m: &Value) -> Option<(String, Loader)> {
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
fn kind_parse(s: &str) -> Option<LoaderType> {
    match s.to_ascii_lowercase().as_str() {
        "forge" => Some(LoaderType::Forge),
        "neoforge" => Some(LoaderType::NeoForge),
        "fabric" => Some(LoaderType::Fabric),
        _ => None,
    }
}
fn forge_name(name: &str) -> Option<(String, Loader)> {
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
pub(super) fn inspect(
    root: &Path,
    options: &InstallOptions,
    metadata_mc: Option<&str>,
    client: Option<&Value>,
) -> Result<PackPlan, SoftwareError> {
    if root.join("mmc-pack.json").exists() && options.launch.is_none() {
        return Err(SoftwareError::PackUnsupported);
    }
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
        .or_else(|| from_jar.map(|x| x.1));
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
                                mc = m.into();
                                loader = Some(Loader {
                                    r#type: kind,
                                    version: v.into(),
                                });
                            }
                        } else {
                            loader = Some(Loader {
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
    let parts = mc
        .split('.')
        .filter_map(|s| s.parse::<u16>().ok())
        .collect::<Vec<_>>();
    let default_java = if parts.first().copied().unwrap_or(1) >= 26 {
        25
    } else if parts.get(1).copied().unwrap_or(0) >= 21
        || (parts.get(1) == Some(&20) && parts.get(2).copied().unwrap_or(0) >= 5)
    {
        21
    } else if parts.get(1).copied().unwrap_or(0) >= 17 {
        17
    } else {
        8
    };
    let java = options
        .java_major
        .or_else(|| {
            values
                .get("RECOMMENDED_JAVA_VERSION")
                .and_then(|s| s.split('.').next()?.parse().ok())
        })
        .unwrap_or(default_java);
    if !(8..=99).contains(&java) {
        return Err(SoftwareError::Invalid);
    }
    if let Some(profile) = &options.launch {
        return Ok(PackPlan {
            mc,
            java: profile.java_major,
            loader,
            profile: profile.clone(),
            install: None,
        });
    }
    let loader = loader.ok_or(SoftwareError::PackUnsupported)?;
    component(&loader.version)?;
    let (mode, path, url, installer, args) = match loader.r#type {
        LoaderType::Forge => {
            let coordinate = format!("{mc}-{}", loader.version);
            let jar = format!("forge-{coordinate}-installer.jar");
            let url = format!(
                "https://maven.minecraftforge.net/net/minecraftforge/forge/{coordinate}/{jar}"
            );
            let modern = parts.get(1).copied().unwrap_or(0) >= 17
                || parts.first().copied().unwrap_or(1) >= 26;
            let path = if modern {
                format!("libraries/net/minecraftforge/forge/{coordinate}/unix_args.txt")
            } else {
                format!("forge-{coordinate}.jar")
            };
            (
                if modern {
                    LaunchMode::Args
                } else {
                    LaunchMode::Jar
                },
                path,
                url,
                jar,
                vec!["--installServer".into()],
            )
        }
        LoaderType::NeoForge => {
            let jar = format!("neoforge-{}-installer.jar", loader.version);
            (
                LaunchMode::Args,
                format!(
                    "libraries/net/neoforged/neoforge/{}/unix_args.txt",
                    loader.version
                ),
                format!(
                    "https://maven.neoforged.net/releases/net/neoforged/neoforge/{}/{jar}",
                    loader.version
                ),
                jar,
                vec!["--installServer".into()],
            )
        }
        LoaderType::Fabric => {
            let installer = "fabric-installer-1.1.0.jar".to_owned();
            (
                LaunchMode::Jar,
                "fabric-server-launch.jar".into(),
                format!(
                    "https://maven.fabricmc.net/net/fabricmc/fabric-installer/1.1.0/{installer}"
                ),
                installer,
                vec![
                    "server".into(),
                    "-mcversion".into(),
                    mc.clone(),
                    "-loader".into(),
                    loader.version.clone(),
                    "-downloadMinecraft".into(),
                ],
            )
        }
    };
    let install = if root.join(&path).is_file() {
        None
    } else {
        Some((url, installer, args))
    };
    Ok(PackPlan {
        mc,
        java,
        loader: Some(loader),
        profile: LaunchProfile {
            mode,
            path,
            java_major: java,
            jvm_args: vec![],
            args: vec![],
        },
        install,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    type Result<T = ()> = std::result::Result<T, Box<dyn std::error::Error>>;
    #[test]
    fn detects_literal_forge_neoforge_and_fabric_without_executing_scripts() -> Result {
        for (name, settings, kind, mode, java) in [
            (
                "ATM10",
                "NEOFORGE_VERSION=21.1.265\n",
                LoaderType::NeoForge,
                LaunchMode::Args,
                21,
            ),
            (
                "ATM9",
                "FORGE_VERSION=47.4.0\n",
                LoaderType::Forge,
                LaunchMode::Args,
                21,
            ),
            (
                "Prominence",
                "MINECRAFT_VERSION=1.20.1\nMODLOADER=Fabric\nMODLOADER_VERSION=0.19.3\nRECOMMENDED_JAVA_VERSION=17",
                LoaderType::Fabric,
                LaunchMode::Jar,
                17,
            ),
            (
                "Better MC",
                "MINECRAFT_VERSION=1.16.5\nMODLOADER=Forge\nMODLOADER_VERSION=36.2.42\nRECOMMENDED_JAVA_VERSION=11.0.24",
                LoaderType::Forge,
                LaunchMode::Jar,
                11,
            ),
        ] {
            let dir = tempfile::tempdir()?;
            std::fs::write(dir.path().join("variables.txt"), settings)?;
            let plan = inspect(dir.path(), &Default::default(), Some("1.21.1"), None)?;
            assert_eq!(plan.loader.ok_or("loader")?.r#type, kind, "{name}");
            assert_eq!(plan.profile.mode, mode);
            assert_eq!(plan.java, java);
            assert!(plan.install.is_some());
        }
        Ok(())
    }
    #[test]
    fn legacy_server_pack_uses_the_client_manifest_only_to_pin_loader_not_add_client_mods() -> Result
    {
        let dir = tempfile::tempdir()?;
        let client = json!({"minecraft":{"version":"1.12.2","modLoaders":[{"id":"forge-14.23.5.2860","primary":true}]},"files":[{"projectID":123,"fileID":456,"required":true}]});
        let plan = inspect(
            dir.path(),
            &Default::default(),
            Some("1.12.2"),
            Some(&client),
        )?;
        assert_eq!(plan.profile.path, "forge-1.12.2-14.23.5.2860.jar");
        assert_eq!(plan.java, 8);
        assert!(
            plan.install
                .ok_or("installer")?
                .0
                .starts_with("https://maven.minecraftforge.net/")
        );
        Ok(())
    }
    #[test]
    fn pixelmon_style_manifest_and_preinstalled_unix_arguments_are_detected() -> Result {
        let dir = tempfile::tempdir()?;
        std::fs::write(
            dir.path().join("manifest.json"),
            r#"{"minecraftVersion":"1.21.1","modloader":"NeoForge","modloaderVersion":"21.1.200"}"#,
        )?;
        let plan = inspect(dir.path(), &Default::default(), None, None)?;
        assert_eq!(plan.java, 21);
        assert_eq!(
            plan.profile.path,
            "libraries/net/neoforged/neoforge/21.1.200/unix_args.txt"
        );
        std::fs::remove_file(dir.path().join("manifest.json"))?;
        let args = dir
            .path()
            .join("libraries/net/minecraftforge/forge/1.20.1-47.4.29");
        std::fs::create_dir_all(&args)?;
        std::fs::write(args.join("unix_args.txt"), "bootstrap-launcher")?;
        let plan = inspect(dir.path(), &Default::default(), Some("1.20.1"), None)?;
        assert!(plan.install.is_none());
        assert_eq!(plan.profile.mode, LaunchMode::Args);
        Ok(())
    }
    #[test]
    fn windows_wrappers_are_flattened_and_client_launcher_exports_are_not_claimed_as_servers()
    -> Result {
        let dir = tempfile::tempdir()?;
        let source = dir.path().join("unpacked");
        std::fs::create_dir_all(source.join("Wrapped Server/mods"))?;
        std::fs::write(source.join("Wrapped Server/mods/fixture.jar"), "mod")?;
        let root = dir.path().join("pack");
        flatten(&source, &root)?;
        assert!(root.join("mods/fixture.jar").is_file());
        std::fs::write(root.join("mmc-pack.json"), "{}")?;
        assert!(matches!(
            inspect(&root, &Default::default(), Some("1.20.1"), None),
            Err(SoftwareError::PackUnsupported)
        ));
        Ok(())
    }
    #[test]
    fn install_overrides_take_priority_and_shell_substitutions_are_never_interpreted() -> Result {
        let dir = tempfile::tempdir()?;
        std::fs::write(
            dir.path().join("variables.txt"),
            "MINECRAFT_VERSION=$(touch owned)\nMODLOADER=Forge\nMODLOADER_VERSION=`malicious`\n",
        )?;
        let options = InstallOptions {
            minecraft_version: Some("1.18.2".into()),
            loader: Some(LoaderType::Forge),
            loader_version: Some("40.3.11".into()),
            java_major: Some(17),
            launch: None,
        };
        let plan = inspect(dir.path(), &options, None, None)?;
        assert_eq!(plan.java, 17);
        assert_eq!(plan.loader.ok_or("loader")?.version, "40.3.11");
        assert!(!dir.path().join("owned").exists());
        Ok(())
    }
}
