//! Readiness, owner player controls and bounded single-owner automation.
use crate::{files::FileError, repository::RepositoryError, server::ServerError};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PlayerIdentity {
    pub name: String,
    pub uuid: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameStatus {
    pub state: String,
    pub observed_at: String,
    pub latency_ms: Option<u64>,
    pub online_players: Option<u32>,
    pub max_players: Option<u32>,
    pub player_sample: Vec<PlayerIdentity>,
    pub version: Option<String>,
    pub connect_address: Option<String>,
    pub detail: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerLists {
    pub whitelist: Vec<Value>,
    pub operators: Vec<Value>,
    pub bans: Vec<Value>,
    pub known_players: Vec<PlayerIdentity>,
    pub running: bool,
    pub online_mode: bool,
    pub whitelist_enabled: bool,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlayerChange {
    pub list: String,
    pub action: String,
    pub name: String,
    pub uuid: Option<String>,
    pub level: Option<u8>,
    pub reason: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
pub struct RecoveryPolicy {
    pub auto_start: bool,
    pub restart_on_crash: bool,
    pub max_attempts: u32,
    pub retry_delay_seconds: u32,
}
impl Default for RecoveryPolicy {
    fn default() -> Self {
        Self {
            auto_start: false,
            restart_on_crash: false,
            max_attempts: 3,
            retry_delay_seconds: 30,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
pub struct BackupPolicy {
    pub enabled: bool,
    pub interval_minutes: u32,
    pub keep_last: Option<u32>,
}
impl Default for BackupPolicy {
    fn default() -> Self {
        Self {
            enabled: false,
            interval_minutes: 1440,
            keep_last: None,
        }
    }
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BackupPolicyWrite {
    pub enabled: bool,
    pub interval_minutes: u32,
    pub keep_last: Option<u32>,
    #[serde(default)]
    pub confirm_retention_deletion: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct AutomationState {
    pub recovery: RecoveryPolicy,
    pub backup: BackupPolicy,
    pub history_enabled: bool,
    pub desired_running: bool,
    pub intent_at: i64,
    pub restart_attempts: u32,
    pub next_retry_at: Option<i64>,
    pub stable_since: Option<i64>,
    pub next_backup_at: Option<i64>,
    pub last_backup_at: Option<i64>,
    pub last_backup_job: Option<String>,
    pub last_backup_export_id: Option<String>,
    pub last_backup_result: Option<String>,
    pub last_backup_error: Option<String>,
    pub last_history_at: Option<i64>,
}
impl Default for AutomationState {
    fn default() -> Self {
        Self {
            recovery: RecoveryPolicy::default(),
            backup: BackupPolicy::default(),
            history_enabled: true,
            desired_running: false,
            intent_at: 0,
            restart_attempts: 0,
            next_retry_at: None,
            stable_since: None,
            next_backup_at: None,
            last_backup_at: None,
            last_backup_job: None,
            last_backup_export_id: None,
            last_backup_result: None,
            last_backup_error: None,
            last_history_at: None,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryPoint {
    pub sampled_at: i64,
    pub cpu_percent: Option<f64>,
    pub memory_working_set_bytes: Option<u64>,
    pub memory_limit_bytes: Option<u64>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MetricsHistory {
    pub enabled: bool,
    pub interval_seconds: u32,
    pub retention_days: u32,
    pub resolution_seconds: u32,
    pub items: Vec<HistoryPoint>,
}

#[derive(Debug, thiserror::Error)]
pub enum OperationsError {
    #[error("The operations sampler is busy.")]
    Busy,
    #[error("{0}")]
    Invalid(&'static str),
    #[error("Player identity could not be resolved; supply a UUID or use a cached player.")]
    Identity,
    #[error("A player list is malformed; correct it in Files before editing.")]
    PlayerFile,
    #[error(transparent)]
    Server(#[from] ServerError),
    #[error(transparent)]
    Files(#[from] FileError),
    #[error(transparent)]
    Storage(#[from] RepositoryError),
    #[error(transparent)]
    Export(#[from] crate::exports::ExportError),
}
impl OperationsError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::Busy => "operations.busy",
            Self::Invalid(_) => "operations.invalid",
            Self::Identity => "players.identity",
            Self::PlayerFile => "players.invalid_file",
            Self::Server(e) => e.code(),
            Self::Export(e) => e.code(),
            Self::Files(_) => "players.files",
            Self::Storage(_) => "operations.storage",
        }
    }
    pub fn public_detail(&self) -> &'static str {
        match self {
            Self::Busy => "The operation is busy; retry shortly.",
            Self::Invalid(detail) => detail,
            Self::Identity => {
                "Provide a valid UUID, select a known player, or check the online profile service."
            }
            Self::PlayerFile => {
                "A player list contains invalid JSON or entries. Existing files were retained."
            }
            Self::Server(_) => "The server operation failed. Check its state and console.",
            Self::Export(e) => e.public_detail(),
            Self::Files(_) => "The player file changed or is unavailable. Refresh and retry.",
            Self::Storage(_) => "The operation could not be saved.",
        }
    }
}

#[async_trait]
pub trait OperationsRepo: Send + Sync {
    async fn load(&self, id: &str) -> Result<AutomationState, RepositoryError>;
    async fn patch(&self, id: &str, patch: Value) -> Result<(), RepositoryError>;
    async fn patch_if_running(&self, id: &str, patch: Value) -> Result<(), RepositoryError>;
    async fn claim_start(
        &self,
        id: &str,
        intent_at: i64,
        patch: Value,
    ) -> Result<bool, RepositoryError>;
    async fn metric(&self, id: &str, point: &HistoryPoint) -> Result<(), RepositoryError>;
    async fn history(&self, id: &str, since: i64) -> Result<Vec<HistoryPoint>, RepositoryError>;
    async fn prune_history(&self, before: i64) -> Result<(), RepositoryError>;
    async fn remember_backup(
        &self,
        id: &str,
        export_id: &str,
        created_at: i64,
    ) -> Result<(), RepositoryError>;
    async fn scheduled_backups(&self, id: &str) -> Result<Vec<String>, RepositoryError>;
    async fn forget_backup(&self, export_id: &str) -> Result<(), RepositoryError>;
}

#[async_trait]
pub trait OperationsService: Send + Sync {
    async fn status(&self, id: &str) -> Result<GameStatus, OperationsError>;
    async fn players(&self, id: &str) -> Result<PlayerLists, OperationsError>;
    async fn change_player(
        &self,
        id: &str,
        change: PlayerChange,
    ) -> Result<PlayerLists, OperationsError>;
    async fn automation(&self, id: &str) -> Result<AutomationState, OperationsError>;
    async fn set_recovery(
        &self,
        id: &str,
        policy: RecoveryPolicy,
    ) -> Result<AutomationState, OperationsError>;
    async fn set_backup(
        &self,
        id: &str,
        request: BackupPolicyWrite,
    ) -> Result<AutomationState, OperationsError>;
    async fn set_history(
        &self,
        id: &str,
        enabled: bool,
    ) -> Result<AutomationState, OperationsError>;
    async fn history(&self, id: &str, hours: u32) -> Result<MetricsHistory, OperationsError>;
}
