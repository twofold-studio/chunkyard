use std::{error::Error, process::Command};

#[test]
fn migration_and_empty_inventory_work_from_the_cli() -> Result<(), Box<dyn Error>> {
    let dir = tempfile::tempdir()?;
    for args in [vec!["migrate"], vec!["java", "list"]] {
        let output = Command::new(env!("CARGO_BIN_EXE_mcm"))
            .arg("--data-dir")
            .arg(dir.path())
            .args(&args)
            .output()?;
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        if args == ["java", "list"] {
            assert_eq!(
                serde_json::from_slice::<serde_json::Value>(&output.stdout)?,
                serde_json::json!([])
            );
        }
    }
    assert!(dir.path().join("mcm.db").is_file());
    Ok(())
}

#[test]
fn missing_runtime_selection_fails_with_an_actionable_message() -> Result<(), Box<dyn Error>> {
    let dir = tempfile::tempdir()?;
    let output = Command::new(env!("CARGO_BIN_EXE_mcm"))
        .arg("--data-dir")
        .arg(dir.path())
        .args(["java", "select", "8", "--strict"])
        .output()?;
    assert!(!output.status.success());
    assert!(String::from_utf8_lossy(&output.stderr).contains("no compatible runtime installed"));
    Ok(())
}

#[test]
fn cli_discovery_honors_disabled_system_java_configuration() -> Result<(), Box<dyn Error>> {
    let dir = tempfile::tempdir()?;
    let config = dir.path().join("mcm.toml");
    std::fs::write(&config, "[java]\nallow_system_java = false\n")?;
    let output = Command::new(env!("CARGO_BIN_EXE_mcm"))
        .arg("--config")
        .arg(&config)
        .arg("--data-dir")
        .arg(dir.path().join("data"))
        .args(["java", "discover"])
        .output()?;
    assert!(!output.status.success());
    assert!(String::from_utf8_lossy(&output.stderr).contains("discovery is disabled"));
    Ok(())
}

#[test]
fn auth_environment_switch_is_visible_in_effective_cli_configuration() -> Result<(), Box<dyn Error>>
{
    let output = Command::new(env!("CARGO_BIN_EXE_mcm"))
        .env("CHUNKYARD_AUTH__ENABLED", "false")
        .args(["config", "check"])
        .output()?;
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let config: serde_json::Value = serde_json::from_slice(&output.stdout)?;
    assert_eq!(config["auth"]["enabled"], false);
    Ok(())
}

#[test]
fn config_path_environment_is_supported_and_old_prefix_is_rejected() -> Result<(), Box<dyn Error>> {
    let dir = tempfile::tempdir()?;
    let path = dir.path().join("chunkyard.toml");
    std::fs::write(&path, "[auth]\nenabled = false\n")?;
    let output = Command::new(env!("CARGO_BIN_EXE_mcm"))
        .env("CHUNKYARD_CONFIG", &path)
        .args(["config", "check"])
        .output()?;
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let config: serde_json::Value = serde_json::from_slice(&output.stdout)?;
    assert_eq!(config["auth"]["enabled"], false);
    let output = Command::new(env!("CARGO_BIN_EXE_mcm"))
        .env("MCM_AUTH__ENABLED", "false")
        .args(["config", "check"])
        .output()?;
    assert!(!output.status.success());
    assert!(String::from_utf8_lossy(&output.stderr).contains("CHUNKYARD_AUTH__ENABLED"));
    Ok(())
}
