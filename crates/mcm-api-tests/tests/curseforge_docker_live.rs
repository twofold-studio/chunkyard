//! Opt-in real loader installation. No Minecraft process is started and no EULA accepted.
use mcm_core::software::Software;
#[tokio::test]
#[ignore = "downloads a real pack and official JDK image; requires CF test credentials/project/client-file IDs"]
async fn real_server_pack_installs_loader_inside_docker_and_publishes_files()
-> Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let mut config = mcm_config::Config {
        data_dir: directory.path().to_owned(),
        ..Default::default()
    };
    config.auth.enabled = false;
    config.curseforge.api_key = Some(std::env::var("CHUNKYARD_TEST_CURSEFORGE_KEY")?);
    let project_id = std::env::var("CHUNKYARD_TEST_CF_PROJECT")?.parse()?;
    let file_id = std::env::var("CHUNKYARD_TEST_CF_FILE")?.parse()?;
    let backend = mcm_server::wiring::build_state(&config).await?;
    let instance=backend.state.servers.create(serde_json::from_value(serde_json::json!({"name":"Disposable modpack install","memoryMinMb":512,"memoryMaxMb":2048,"cpus":2,"software":Software::CurseForge{project_id,file_id}}))?).await?;
    let outcome = backend.state.servers.install(&instance.server.id).await;
    if let Ok(installed) = &outcome {
        let launch = installed.server.launch.as_ref().ok_or("missing launch")?;
        assert!(installed.directory.join(&launch.path).is_file());
        assert!(installed.directory.join("mods").is_dir());
        assert!(!installed.server.accept_eula);
        assert_eq!(
            std::fs::read_to_string(installed.directory.join("eula.txt"))?,
            "eula=false\n"
        );
        assert_eq!(
            installed.status.state,
            mcm_core::server::ServerState::Stopped
        );
        println!(
            "installed project {project_id}, Minecraft {}, Java {}, launch {}",
            launch.version, launch.java_major, launch.path
        );
    }
    backend.state.servers.shutdown().await;
    let cleanup = backend
        .state
        .servers
        .delete(&instance.server.id, true)
        .await;
    backend.shutdown().await;
    outcome?;
    cleanup?;
    Ok(())
}
