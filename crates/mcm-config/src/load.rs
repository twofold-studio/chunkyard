use crate::{Config, ConfigError};
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
};
impl Config {
    pub fn load(path: Option<&Path>) -> Result<Self, ConfigError> {
        let default_path = Path::new("/etc/mcm/mcm.toml");
        let environment: BTreeMap<_, _> = std::env::vars().collect();
        let env_path = environment.get("CHUNKYARD_CONFIG").map(PathBuf::from);
        let path = path
            .or(env_path.as_deref())
            .or_else(|| default_path.is_file().then_some(default_path));
        Self::load_with_env(path, environment)
    }
    /// Explicit inputs allow tests without unsafe process-global environment mutation.
    pub fn load_with_env(
        path: Option<&Path>,
        environment: impl IntoIterator<Item = (String, String)>,
    ) -> Result<Self, ConfigError> {
        let environment: BTreeMap<_, _> = environment.into_iter().collect();
        let env_path = environment.get("CHUNKYARD_CONFIG").map(PathBuf::from);
        let mut config: Self = if let Some(path) = path.or(env_path.as_deref()) {
            toml::from_str(&std::fs::read_to_string(path)?)?
        } else {
            Self::default()
        };
        for (key, value) in environment {
            if let Some(legacy_suffix) = key.strip_prefix("MCM_") {
                return Err(ConfigError::Invalid(format!(
                    "{key} is no longer supported; rename it to CHUNKYARD_{}",
                    legacy_suffix
                )));
            }
            let Some(suffix) = key.strip_prefix("CHUNKYARD_") else {
                continue;
            };
            let invalid = || ConfigError::Invalid(format!("invalid value for {key}"));
            match suffix {
                "CURSEFORGE__API_KEY" => {
                    config.curseforge.api_key = if value.is_empty() { None } else { Some(value) }
                }
                "AUTH__ENABLED" => config.auth.enabled = value.parse().map_err(|_| invalid())?,
                "DOCKER__ENABLED" => {
                    config.docker.enabled = value.parse().map_err(|_| invalid())?
                }
                "DOCKER__RUNTIME_IMAGE" => config.docker.runtime_image = value,
                "DOCKER__PUBLISH_IP" => {
                    config.docker.publish_ip = value.parse().map_err(|_| invalid())?
                }
                "DOCKER__STOP_TIMEOUT_S" => {
                    config.docker.stop_timeout_s = value.parse().map_err(|_| invalid())?
                }
                "DOCKER__USER" => config.docker.user = Some(value),
                "DOCKER__HOST_DATA_DIR" => config.docker.host_data_dir = Some(value.into()),
                "DATA_DIR" => config.data_dir = value.into(),
                "HTTP__LISTEN" => config.http.listen = value.parse().map_err(|_| invalid())?,
                "HTTP__UI_DIR" => {
                    config.http.ui_dir = if value.is_empty() {
                        None
                    } else {
                        Some(value.into())
                    }
                }
                "HTTP__SHOW_VERSION" => {
                    config.http.show_version = value.parse().map_err(|_| invalid())?
                }
                "HTTP__PUBLIC_URL" => config.http.public_url = Some(value),
                "HTTP__ALLOW_INSECURE_HTTP" => {
                    config.http.allow_insecure_http = value.parse().map_err(|_| invalid())?
                }
                "JAVA__ALLOW_SYSTEM_JAVA" => {
                    config.java.allow_system_java = value.parse().map_err(|_| invalid())?
                }
                _ if suffix.contains("__") && !suffix.starts_with("TEST_") => {
                    return Err(ConfigError::Invalid(format!(
                        "unknown environment setting {key}"
                    )));
                }
                _ => (),
            }
        }
        // CLI overrides are applied by the caller before final validation.
        Ok(config)
    }
}
