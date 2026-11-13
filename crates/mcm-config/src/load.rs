use crate::{Config, ConfigError};
use std::path::Path;
impl Config {
    pub fn load(path: Option<&Path>) -> Result<Self, ConfigError> {
        let default_path = Path::new("/etc/mcm/mcm.toml");
        let path = path.or_else(|| default_path.is_file().then_some(default_path));
        Self::load_with_env(path, std::env::vars())
    }
    /// Explicit inputs allow tests without unsafe process-global environment mutation.
    pub fn load_with_env(
        path: Option<&Path>,
        environment: impl IntoIterator<Item = (String, String)>,
    ) -> Result<Self, ConfigError> {
        let mut config: Self = if let Some(path) = path {
            toml::from_str(&std::fs::read_to_string(path)?)?
        } else {
            Self::default()
        };
        for (key, value) in environment {
            let invalid = || ConfigError::Invalid(format!("invalid value for {key}"));
            match key.as_str() {
                "MCM_AUTH__ENABLED" => {
                    config.auth.enabled = value.parse().map_err(|_| invalid())?
                }
                "MCM_DOCKER__ENABLED" => {
                    config.docker.enabled = value.parse().map_err(|_| invalid())?
                }
                "MCM_DOCKER__RUNTIME_IMAGE" => config.docker.runtime_image = value,
                "MCM_DOCKER__PUBLISH_IP" => {
                    config.docker.publish_ip = value.parse().map_err(|_| invalid())?
                }
                "MCM_DOCKER__STOP_TIMEOUT_S" => {
                    config.docker.stop_timeout_s = value.parse().map_err(|_| invalid())?
                }
                "MCM_DOCKER__USER" => config.docker.user = Some(value),
                "MCM_DOCKER__HOST_DATA_DIR" => config.docker.host_data_dir = Some(value.into()),
                "MCM_DATA_DIR" => config.data_dir = value.into(),
                "MCM_HTTP__LISTEN" => config.http.listen = value.parse().map_err(|_| invalid())?,
                "MCM_HTTP__PUBLIC_URL" => config.http.public_url = Some(value),
                "MCM_HTTP__ALLOW_INSECURE_HTTP" => {
                    config.http.allow_insecure_http = value.parse().map_err(|_| invalid())?
                }
                "MCM_JAVA__ALLOW_SYSTEM_JAVA" => {
                    config.java.allow_system_java = value.parse().map_err(|_| invalid())?
                }
                _ if key.starts_with("MCM_")
                    && key.contains("__")
                    && !key.starts_with("MCM_TEST_") =>
                {
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
