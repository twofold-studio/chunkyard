//! Read literal pack metadata, never evaluate a publisher's shell or PowerShell.
mod launch;
mod loaders;
mod metadata;
use chunkyard_core::software::*;
use serde_json::Value;
use std::path::Path;
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
pub(super) fn inspect(
    root: &Path,
    options: &InstallOptions,
    metadata_mc: Option<&str>,
    client: Option<&Value>,
) -> Result<PackPlan, SoftwareError> {
    if root.join("mmc-pack.json").exists() && options.launch.is_none() {
        return Err(SoftwareError::PackUnsupported);
    }
    let metadata = metadata::Metadata::gather(root, client)?;
    let (mc, loader) = metadata.resolve(root, options, metadata_mc)?;
    let parts = mc
        .split('.')
        .filter_map(|s| s.parse::<u16>().ok())
        .collect::<Vec<_>>();
    let java = launch::java_major(&parts, &metadata.values, options)?;
    launch::plan(root, options, mc, loader, java, &parts)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    type Result<T = ()> = std::result::Result<T, Box<dyn std::error::Error>>;
    #[test]
    fn explicit_launch_keeps_java_validation_order_and_profile_java() -> Result {
        let root = tempfile::tempdir()?;
        let mut options = InstallOptions {
            minecraft_version: Some("1.20.1".into()),
            java_major: Some(7),
            launch: Some(LaunchProfile {
                mode: LaunchMode::Jar,
                path: "custom.jar".into(),
                java_major: 11,
                jvm_args: vec![],
                args: vec![],
            }),
            ..Default::default()
        };
        assert!(matches!(
            inspect(root.path(), &options, None, None),
            Err(SoftwareError::Invalid)
        ));
        options.java_major = Some(17);
        let plan = inspect(root.path(), &options, None, None)?;
        assert_eq!(plan.java, 11);
        assert!(plan.install.is_none());
        Ok(())
    }

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
