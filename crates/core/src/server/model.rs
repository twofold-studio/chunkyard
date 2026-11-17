use super::RuntimeStatus;
use serde::{Deserialize, Serialize};
use std::{net::IpAddr, path::PathBuf};
#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Server {
    #[serde(default)]
    #[schema(required = true)]
    pub archive: Option<ArchiveReference>,
    #[schema(required = true)]
    pub id: String,
    #[schema(required = true)]
    pub name: String,
    #[schema(required = true)]
    pub runtime: String,
    #[schema(required = true)]
    pub jar: String,
    #[schema(required = true)]
    pub docker_image: String,
    #[schema(required = true)]
    pub port: u16,
    #[schema(required = true)]
    pub memory_min_mb: u32,
    #[schema(required = true)]
    pub memory_max_mb: u32,
    #[schema(required = true)]
    pub cpus: f64,
    #[schema(required = true)]
    pub accept_eula: bool,
    #[serde(default)]
    #[schema(required = true)]
    pub software: Option<crate::software::Software>,
    #[serde(default)]
    #[schema(required = true)]
    pub launch: Option<crate::software::Launch>,
    #[serde(default)]
    #[schema(required = true)]
    pub auto_java: bool,
    #[serde(default)]
    #[schema(value_type = Option<String>)]
    #[schema(required = true)]
    pub publish_ip: Option<IpAddr>,
    #[serde(default)]
    #[schema(required = true)]
    pub launch_override: Option<crate::software::LaunchProfile>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveReference {
    pub export_id: String,
    pub archived_at: String,
}
#[derive(Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct LaunchSettings {
    pub detected: crate::software::LaunchProfile,
    pub current: crate::software::LaunchProfile,
    pub overridden: bool,
    pub docker_image: String,
    pub auto_java: bool,
}
#[derive(Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LaunchUpdate {
    #[serde(deserialize_with = "deserialize_profile")]
    #[schema(required = true)]
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

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct NetworkSettings {
    pub port: u16,
    #[schema(value_type = Option<String>)]
    pub publish_ip: Option<IpAddr>,
    #[schema(value_type = String)]
    pub effective_publish_ip: IpAddr,
    pub bound_publish_ip: Option<String>,
    pub bound_port: Option<u16>,
    pub restart_required: bool,
    pub status: RuntimeStatus,
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NetworkUpdate {
    pub port: u16,
    #[schema(value_type = Option<String>)]
    pub publish_ip: Option<IpAddr>,
}
#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResourceUpdate {
    pub memory_min_mb: u32,
    pub memory_max_mb: u32,
    pub cpus: f64,
}
#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
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
#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ServerView {
    #[serde(flatten)]
    #[schema(required = true)]
    pub server: Server,
    #[schema(value_type = String)]
    #[schema(required = true)]
    pub directory: PathBuf,
    #[schema(required = true)]
    pub status: RuntimeStatus,
    #[schema(required = true)]
    pub icon: Option<DisplayIcon>,
}
#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub struct DisplayIcon {
    pub url: String,
    pub source: &'static str,
}
/// Completed deletion. Retained files are never implicitly adopted by a new instance.
#[derive(Debug, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct DeletedServer {
    pub id: String,
    pub files_deleted: bool,
    #[schema(value_type = Option<String>)]
    pub retained_directory: Option<PathBuf>,
}
