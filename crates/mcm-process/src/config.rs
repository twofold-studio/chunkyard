use serde::{Deserialize, Serialize};
use std::{net::IpAddr, path::PathBuf};

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(default, deny_unknown_fields)]
pub struct DockerConfig {
    pub enabled: bool,
    pub runtime_image: String,
    pub publish_ip: IpAddr,
    pub stop_timeout_s: u32,
    /// Override the UID:GID used inside containers; rootless engines use 0:0 by default.
    pub user: Option<String>,
    /// Host-visible data path when the manager itself is containerized.
    pub host_data_dir: Option<PathBuf>,
}
impl Default for DockerConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            runtime_image: "eclipse-temurin:21-jre".into(),
            publish_ip: [0, 0, 0, 0].into(),
            stop_timeout_s: 60,
            user: None,
            host_data_dir: None,
        }
    }
}
