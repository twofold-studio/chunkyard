//! Java selection and launch/installer planning without evaluating publisher scripts.
use super::PackPlan;
use chunkyard_core::software::*;
use std::{collections::BTreeMap, path::Path};

pub(super) fn java_major(
    parts: &[u16],
    values: &BTreeMap<String, String>,
    options: &InstallOptions,
) -> Result<u16, SoftwareError> {
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
    Ok(java)
}

pub(super) fn plan(
    root: &Path,
    options: &InstallOptions,
    mc: String,
    loader: Option<Loader>,
    java: u16,
    parts: &[u16],
) -> Result<PackPlan, SoftwareError> {
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

    #[test]
    fn java_defaults_preserve_minecraft_release_boundaries() -> Result<(), SoftwareError> {
        for (parts, expected) in [
            (vec![1, 16, 5], 8),
            (vec![1, 17], 17),
            (vec![1, 20, 4], 17),
            (vec![1, 20, 5], 21),
            (vec![1, 21, 1], 21),
            (vec![26, 1], 25),
        ] {
            assert_eq!(
                java_major(&parts, &BTreeMap::new(), &Default::default())?,
                expected
            );
        }
        Ok(())
    }

    #[test]
    fn java_override_precedes_literal_recommendation_and_keeps_bounds() -> Result<(), SoftwareError>
    {
        let values = BTreeMap::from([("RECOMMENDED_JAVA_VERSION".into(), "11.0.24".into())]);
        assert_eq!(java_major(&[1, 21, 1], &values, &Default::default())?, 11);
        let mut options = InstallOptions {
            java_major: Some(17),
            ..Default::default()
        };
        assert_eq!(java_major(&[1, 21, 1], &values, &options)?, 17);
        for invalid in [7, 100] {
            options.java_major = Some(invalid);
            assert!(matches!(
                java_major(&[1, 21, 1], &values, &options),
                Err(SoftwareError::Invalid)
            ));
        }
        Ok(())
    }
}
