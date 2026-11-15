use std::{error::Error, process::Command};

#[test]
fn migrate_works_and_host_java_commands_are_removed() -> Result<(), Box<dyn Error>> {
    let dir = tempfile::tempdir()?;
    let output = Command::new(env!("CARGO_BIN_EXE_mcm"))
        .arg("--data-dir")
        .arg(dir.path())
        .arg("migrate")
        .output()?;
    assert!(output.status.success());
    assert!(dir.path().join("mcm.db").is_file());
    let output = Command::new(env!("CARGO_BIN_EXE_mcm"))
        .args(["java", "list"])
        .output()?;
    assert!(!output.status.success());
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
