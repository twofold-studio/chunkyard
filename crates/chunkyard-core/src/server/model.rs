use super::RuntimeStatus;
use serde::{Deserialize, Serialize};
use std::{net::IpAddr, path::PathBuf};
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Server {
    #[serde(default)]
    pub archive: Option<ArchiveReference>,
    pub id: String,
    pub name: String,
    pub runtime: String,
    pub jar: String,
    pub docker_image: String,
    pub port: u16,
    pub memory_min_mb: u32,
    pub memory_max_mb: u32,
    pub cpus: f64,
    pub accept_eula: bool,
    #[serde(default)]
    pub software: Option<crate::software::Software>,
    #[serde(default)]
    pub launch: Option<crate::software::Launch>,
    #[serde(default)]
    pub auto_java: bool,
    #[serde(default)]
    pub publish_ip: Option<IpAddr>,
    #[serde(default)]
    pub launch_override: Option<crate::software::LaunchProfile>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveReference {
    pub export_id: String,
    pub archived_at: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchSettings {
    pub detected: crate::software::LaunchProfile,
    pub current: crate::software::LaunchProfile,
    pub overridden: bool,
    pub docker_image: String,
    pub auto_java: bool,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LaunchUpdate {
    #[serde(deserialize_with = "deserialize_profile")]
    pub profile: Option<crate::software::LaunchProfile>,
    #[serde(default, deserialize_with = "deserialize_image")]
    pub docker_image: Option<Option<String>>,
}
fn deserialize_profile<'de, D: serde::Deserializer<'de>>(
    d: D,
) -> Result<Option<crate::software::LaunchProfile>, D::Error> {
    Option::<crate::software::LaunchProfile>::deserialize(d)
}
fn deserialize_image<'de, D: serde::Deserializer<'de>>(
    d: D,
) -> Result<Option<Option<String>>, D::Error> {
    Ok(Some(Option::<String>::deserialize(d)?))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkSettings {
    pub port: u16,
    pub publish_ip: Option<IpAddr>,
    pub effective_publish_ip: IpAddr,
    pub bound_publish_ip: Option<String>,
    pub bound_port: Option<u16>,
    pub restart_required: bool,
    pub status: RuntimeStatus,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NetworkUpdate {
    pub port: u16,
    pub publish_ip: Option<IpAddr>,
}
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResourceUpdate {
    pub memory_min_mb: u32,
    pub memory_max_mb: u32,
    pub cpus: f64,
}
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateServer {
    #[serde(default = "default_runtime")]
    pub runtime: String,
    pub name: String,
    /// Omit/null to allocate an unassigned managed host port.
    #[serde(default)]
    pub port: Option<u16>,
    #[serde(default = "default_jar")]
    pub jar: String,
    #[serde(default)]
    pub docker_image: Option<String>,
    #[serde(default = "default_min")]
    pub memory_min_mb: u32,
    #[serde(default = "default_max")]
    pub memory_max_mb: u32,
    #[serde(default = "default_cpus")]
    pub cpus: f64,
    #[serde(default)]
    pub accept_eula: bool,
    #[serde(default)]
    pub software: Option<crate::software::Software>,
}
fn default_runtime() -> String {
    "docker".into()
}
fn default_jar() -> String {
    "server.jar".into()
}
fn default_min() -> u32 {
    512
}
fn default_max() -> u32 {
    2048
}
fn default_cpus() -> f64 {
    2.0
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerView {
    #[serde(flatten)]
    pub server: Server,
    pub directory: PathBuf,
    pub status: RuntimeStatus,
    pub icon: Option<DisplayIcon>,
}
#[derive(Debug, Clone, Serialize)]
pub struct DisplayIcon {
    pub url: String,
    pub source: &'static str,
}
/// Completed deletion. Retained files are never implicitly adopted by a new instance.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeletedServer {
    pub id: String,
    pub files_deleted: bool,
    pub retained_directory: Option<PathBuf>,
}
