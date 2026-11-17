use serde::{Deserialize, Serialize};
use std::{net::SocketAddr, path::PathBuf};
use url::Url;

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(default, deny_unknown_fields)]
pub struct Config {
    pub data_dir: PathBuf,
    pub http: HttpConfig,
    pub auth: AuthConfig,
    pub docker: chunkyard_process::DockerConfig,
    pub curseforge: CurseForgeConfig,
}
#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(default, deny_unknown_fields)]
pub struct CurseForgeConfig {
    #[serde(skip_serializing)]
    pub api_key: Option<String>,
}
impl std::fmt::Debug for CurseForgeConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("CurseForgeConfig")
            .field("configured", &self.api_key.is_some())
            .finish()
    }
}
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(default, deny_unknown_fields)]
pub struct AuthConfig {
    pub enabled: bool,
}
impl Default for AuthConfig {
    fn default() -> Self {
        Self { enabled: true }
    }
}
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(default, deny_unknown_fields)]
pub struct HttpConfig {
    pub listen: SocketAddr,
    pub public_url: Option<String>,
    /// HTTP on a non-loopback interface requires this explicit opt-in.
    pub allow_insecure_http: bool,
    /// Static SPA build directory; None keeps the service API-only.
    pub ui_dir: Option<PathBuf>,
    /// Publish the optional version badge and bundled changelog.
    pub show_version: bool,
}
impl Default for HttpConfig {
    fn default() -> Self {
        Self {
            listen: ([127, 0, 0, 1], 8420).into(),
            public_url: None,
            allow_insecure_http: false,
            ui_dir: Some("web/build".into()),
            show_version: true,
        }
    }
}
impl Default for Config {
    fn default() -> Self {
        Self {
            data_dir: "data".into(),
            http: HttpConfig::default(),
            auth: AuthConfig::default(),
            docker: chunkyard_process::DockerConfig::default(),
            curseforge: CurseForgeConfig::default(),
        }
    }
}
#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Toml(#[from] toml::de::Error),
    #[error("invalid configuration: {0}")]
    Invalid(String),
}
impl Config {
    pub fn validate(&self) -> Result<(), ConfigError> {
        if self.data_dir.as_os_str().is_empty() {
            return Err(ConfigError::Invalid("data_dir is empty".into()));
        }
        if !self.http.listen.ip().is_loopback() && self.http.public_url.is_none() {
            return Err(ConfigError::Invalid(
                "http.public_url is required for non-loopback listeners".into(),
            ));
        }
        if !(1..=300).contains(&self.docker.stop_timeout_s) {
            return Err(ConfigError::Invalid(
                "docker.stop_timeout_s must be between 1 and 300".into(),
            ));
        }
        if self.docker.connect_host.as_ref().is_some_and(|host| {
            host.is_empty()
                || host.len() > 253
                || host.chars().any(|c| {
                    c.is_whitespace() || c.is_control() || matches!(c, '/' | '\\' | '@' | '?' | '#')
                })
        }) {
            return Err(ConfigError::Invalid(
                "docker.connect_host must be a host name or IP address, without a URL or path"
                    .into(),
            ));
        }
        if let Some(path) = &self.docker.host_data_dir
            && !path.is_absolute()
        {
            return Err(ConfigError::Invalid(
                "docker.host_data_dir must be absolute".into(),
            ));
        }
        if let Some(user) = &self.docker.user {
            let parts: Vec<_> = user.split(':').collect();
            if parts.len() != 2 || parts.iter().any(|part| part.parse::<u32>().is_err()) {
                return Err(ConfigError::Invalid(
                    "docker.user must be numeric UID:GID".into(),
                ));
            }
        }
        if self.docker.runtime_image.is_empty()
            || self.docker.runtime_image.len() > 255
            || !self
                .docker
                .runtime_image
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"/_.:@-".contains(&b))
        {
            return Err(ConfigError::Invalid(
                "docker.runtime_image is invalid".into(),
            ));
        }
        self.origin()?;
        Ok(())
    }
    pub fn origin(&self) -> Result<String, ConfigError> {
        let Some(value) = &self.http.public_url else {
            return Ok(format!("http://{}", self.http.listen));
        };
        let url = Url::parse(value).map_err(|_| {
            ConfigError::Invalid("http.public_url must be an absolute HTTP(S) URL".into())
        })?;
        if !matches!(url.scheme(), "http" | "https")
            || url.host_str().is_none()
            || !url.username().is_empty()
            || url.password().is_some()
            || url.query().is_some()
            || url.fragment().is_some()
            || url.path() != "/"
        {
            return Err(ConfigError::Invalid(
                "http.public_url must contain only an HTTP(S) origin".into(),
            ));
        }
        if url.scheme() == "http"
            && !self.http.listen.ip().is_loopback()
            && !self.http.allow_insecure_http
        {
            return Err(ConfigError::Invalid(
                "remote HTTP requires allow_insecure_http=true or HTTPS through a reverse proxy"
                    .into(),
            ));
        }
        Ok(url.origin().ascii_serialization())
    }
    pub fn secure_cookie(&self) -> bool {
        self.http
            .public_url
            .as_ref()
            .is_some_and(|u| u.starts_with("https://"))
    }
}
