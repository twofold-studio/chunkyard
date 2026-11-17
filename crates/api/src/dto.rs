//! Concrete JSON envelopes used by handlers and their generated contract.
use chunkyard_core::{
    auth::{ApiKey, User},
    files::FileEntry,
    jobs::Job,
    server::{DockerInfo, ServerView},
};
use serde::Serialize;
use utoipa::ToSchema;

#[derive(Serialize, serde::Deserialize, ToSchema)]
pub(crate) struct Items<T> {
    pub items: Vec<T>,
}
#[derive(Serialize, ToSchema)]
pub(crate) struct ServerResponse {
    pub server: ServerView,
}
#[derive(Serialize, ToSchema)]
pub(crate) struct JobResponse {
    pub job: Job,
}
#[derive(Serialize, ToSchema)]
pub(crate) struct EntryResponse {
    pub entry: FileEntry,
}
#[derive(Serialize, ToSchema)]
pub(crate) struct Isolation {
    pub docker: DockerInfo,
}
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SetupStatus {
    pub required: bool,
    pub auth_enabled: bool,
}
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub(crate) enum PrincipalKind {
    Session,
    ApiKey,
    AuthDisabled,
}
#[derive(Serialize, ToSchema)]
pub(crate) struct Principal {
    pub kind: PrincipalKind,
}
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Me {
    pub auth_enabled: bool,
    #[schema(required = true)]
    pub user: Option<User>,
    pub principal: Principal,
    pub is_admin: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub must_change_password: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub totp_enabled: Option<bool>,
}
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub(crate) enum LoginKind {
    Session,
}
#[derive(Serialize, ToSchema)]
pub(crate) struct LoginResponse {
    pub kind: LoginKind,
    pub me: Me,
}
#[derive(Serialize, ToSchema)]
pub(crate) struct CreatedApiKey {
    pub key: ApiKey,
    pub token: String,
}
#[derive(Serialize, ToSchema)]
pub(crate) struct Health {
    pub status: &'static str,
}
#[derive(Serialize, ToSchema)]
pub(crate) struct VersionInfo {
    pub enabled: bool,
    #[schema(required = true)]
    pub version: Option<&'static str>,
    #[schema(required = true)]
    pub channel: Option<&'static str>,
}
#[derive(Serialize, ToSchema)]
pub(crate) struct Changelog {
    pub version: &'static str,
    pub markdown: &'static str,
}
#[derive(Serialize, ToSchema)]
pub(crate) struct StorageTest {
    pub ok: bool,
}

#[derive(Serialize, serde::Deserialize, ToSchema)]
pub(crate) struct SoftwareCatalogItem {
    pub id: SoftwareKind,
    pub name: String,
    pub available: bool,
    #[schema(required = true)]
    pub reason: Option<String>,
}
#[derive(Serialize, serde::Deserialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub(crate) enum SoftwareKind {
    Vanilla,
    Paper,
    Purpur,
    Fabric,
    Forge,
    NeoForge,
    CurseForge,
    Custom,
}
#[derive(Serialize, serde::Deserialize, ToSchema)]
pub(crate) struct SoftwareVersion {
    pub id: String,
    pub stable: bool,
}
#[derive(Serialize, serde::Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CurseForgeModpack {
    pub id: u64,
    pub name: String,
    pub summary: String,
    #[schema(required = true)]
    pub website_url: Option<String>,
    #[schema(required = true)]
    pub logo_url: Option<String>,
    pub downloads: u64,
}
#[derive(Serialize, serde::Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CurseForgePagination {
    pub index: u32,
    pub page_size: u32,
    pub total_count: u64,
}
#[derive(Serialize, serde::Deserialize, ToSchema)]
pub(crate) struct CurseForgeSearch {
    pub items: Vec<CurseForgeModpack>,
    pub pagination: CurseForgePagination,
}
#[derive(Serialize, serde::Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CurseForgeFile {
    pub id: u64,
    pub name: String,
    pub game_versions: Vec<String>,
    pub server_pack_file_id: u64,
}

/// Raw HTTP body; never JSON encoded.
pub(crate) struct BinaryBody;
impl utoipa::PartialSchema for BinaryBody {
    fn schema() -> utoipa::openapi::RefOr<utoipa::openapi::schema::Schema> {
        use utoipa::openapi::schema::{KnownFormat, ObjectBuilder, SchemaFormat, Type};
        ObjectBuilder::new()
            .schema_type(Type::String)
            .format(Some(SchemaFormat::KnownFormat(KnownFormat::Binary)))
            .into()
    }
}
impl utoipa::ToSchema for BinaryBody {}

/// Requests retain serde defaults; policy responses always include all fields.
#[derive(serde::Deserialize, ToSchema)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct RecoveryPolicyRequest {
    pub auto_start: bool,
    pub restart_on_crash: bool,
    pub max_attempts: u32,
    pub retry_delay_seconds: u32,
}
impl Default for RecoveryPolicyRequest {
    fn default() -> Self {
        let policy = chunkyard_core::operations::RecoveryPolicy::default();
        Self {
            auto_start: policy.auto_start,
            restart_on_crash: policy.restart_on_crash,
            max_attempts: policy.max_attempts,
            retry_delay_seconds: policy.retry_delay_seconds,
        }
    }
}
impl From<RecoveryPolicyRequest> for chunkyard_core::operations::RecoveryPolicy {
    fn from(policy: RecoveryPolicyRequest) -> Self {
        Self {
            auto_start: policy.auto_start,
            restart_on_crash: policy.restart_on_crash,
            max_attempts: policy.max_attempts,
            retry_delay_seconds: policy.retry_delay_seconds,
        }
    }
}
