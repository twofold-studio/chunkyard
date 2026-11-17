//! Explicit opt-in metadata/archive verification; never starts Minecraft or accepts its EULA.
use chunkyard_core::software::{InstallOptions, Software, SoftwareService};
use std::sync::Arc;
#[tokio::test]
#[ignore = "downloads a real server ZIP; requires CHUNKYARD_TEST_CURSEFORGE_KEY, project and client-file IDs"]
async fn real_server_pack_download_extract_and_detect() -> Result<(), Box<dyn std::error::Error>> {
    let key = std::env::var("CHUNKYARD_TEST_CURSEFORGE_KEY")?;
    let project_id = std::env::var("CHUNKYARD_TEST_CF_PROJECT")?.parse()?;
    let file_id = std::env::var("CHUNKYARD_TEST_CF_FILE")?.parse()?;
    let dir = Arc::new(tempfile::tempdir()?);
    let installers = chunkyard_install::Installers::new()?.with_curseforge(Some(key));
    let plan = installers
        .prepare_plan(
            &Software::CurseForge {
                project_id,
                file_id,
            },
            dir.path(),
            &InstallOptions::default(),
            dir.clone(),
        )
        .await?;
    assert!(plan.instance_files);
    assert_eq!(plan.launch.checksum.len(), 64);
    assert!(dir.path().join("pack/mods").is_dir());
    println!(
        "verified project {project_id}, client {file_id}, Minecraft {}, Java {}, launch {}",
        plan.launch.version, plan.launch.java_major, plan.launch.path
    );
    Ok(())
}
