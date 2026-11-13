use mcm_config::Config;
#[test]
fn file_environment_and_cli_sources_have_explicit_precedence()
-> Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let path = directory.path().join("mcm.toml");
    std::fs::write(
        &path,
        "data_dir = 'from-file'\n[http]\nlisten = '127.0.0.1:9000'\n",
    )?;
    let mut config =
        Config::load_with_env(Some(&path), [("MCM_DATA_DIR".into(), "from-env".into())])?;
    assert_eq!(config.data_dir.to_str(), Some("from-env"));
    config.data_dir = "from-cli".into();
    config.validate()?;
    assert_eq!(config.http.listen.port(), 9000);
    Ok(())
}
#[test]
fn non_loopback_listeners_require_a_public_origin_and_explicit_http_opt_in()
-> Result<(), Box<dyn std::error::Error>> {
    let mut config = Config::default();
    config.http.listen = "0.0.0.0:8420".parse()?;
    assert!(config.validate().is_err());
    config.http.public_url = Some("http://mc.example.com".into());
    assert!(config.validate().is_err());
    config.http.public_url = Some("https://mc.example.com".into());
    config.validate()?;
    assert!(config.secure_cookie());
    Ok(())
}
#[test]
fn unknown_keys_and_origins_with_credentials_paths_or_queries_fail()
-> Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let path = directory.path().join("bad.toml");
    std::fs::write(&path, "[http]\nlitsen = '127.0.0.1:9000'\n")?;
    assert!(Config::load_with_env(Some(&path), []).is_err());
    assert!(Config::load_with_env(None, [("MCM_HTTP__LITSEN".into(), "bad".into())]).is_err());
    for value in [
        "https://user:pass@example.com",
        "https://example.com/panel",
        "file:///tmp",
        "https://example.com/?secret=x",
    ] {
        let mut config = Config::default();
        config.http.public_url = Some(value.into());
        assert!(config.validate().is_err(), "{value}");
    }
    Ok(())
}

#[test]
fn auth_is_enabled_by_default_and_env_can_override_the_file()
-> Result<(), Box<dyn std::error::Error>> {
    assert!(Config::default().auth.enabled);
    let directory = tempfile::tempdir()?;
    let path = directory.path().join("mcm.toml");
    std::fs::write(&path, "[auth]\nenabled = true\n")?;
    let config =
        Config::load_with_env(Some(&path), [("MCM_AUTH__ENABLED".into(), "false".into())])?;
    assert!(!config.auth.enabled);
    config.validate()?;
    assert!(Config::load_with_env(None, [("MCM_AUTH__ENABLED".into(), "perhaps".into())]).is_err());
    Ok(())
}

#[test]
fn docker_environment_settings_are_validated_before_startup()
-> Result<(), Box<dyn std::error::Error>> {
    let config = Config::load_with_env(
        None,
        [
            ("MCM_DOCKER__ENABLED".into(), "false".into()),
            ("MCM_DOCKER__PUBLISH_IP".into(), "0.0.0.0".into()),
            ("MCM_DOCKER__STOP_TIMEOUT_S".into(), "15".into()),
        ],
    )?;
    config.validate()?;
    assert!(!config.docker.enabled);
    assert_eq!(config.docker.publish_ip.to_string(), "0.0.0.0");
    for (key, value) in [
        ("MCM_DOCKER__STOP_TIMEOUT_S", "0"),
        ("MCM_DOCKER__USER", "root"),
        ("MCM_DOCKER__HOST_DATA_DIR", "relative/path"),
    ] {
        let config = Config::load_with_env(None, [(key.into(), value.into())])?;
        assert!(config.validate().is_err());
    }
    Ok(())
}

#[test]
fn ui_build_directory_can_be_selected_or_disabled_by_environment()
-> Result<(), Box<dyn std::error::Error>> {
    assert_eq!(
        Config::default().http.ui_dir.as_deref(),
        Some(std::path::Path::new("web/build"))
    );
    let config =
        Config::load_with_env(None, [("MCM_HTTP__UI_DIR".into(), "installed/web".into())])?;
    assert_eq!(
        config.http.ui_dir.as_deref(),
        Some(std::path::Path::new("installed/web"))
    );
    let config = Config::load_with_env(None, [("MCM_HTTP__UI_DIR".into(), String::new())])?;
    assert!(config.http.ui_dir.is_none());
    Ok(())
}
