mod players;
mod worker;
use async_trait::async_trait;
use chunkyard_core::{
    exports::ExportService,
    files::FileService,
    operations::*,
    properties::PropertiesService,
    server::{ServerService, ServerState},
};
use serde_json::json;
use std::sync::Arc;
use time::{OffsetDateTime, format_description::well_known::Rfc3339};

pub struct Operations {
    pub(crate) repo: Arc<dyn OperationsRepo>,
    pub(crate) servers: Arc<dyn ServerService>,
    pub(crate) files: Arc<dyn FileService>,
    pub(crate) properties: Arc<dyn PropertiesService>,
    pub(crate) exports: Arc<dyn ExportService>,
    connect_host: String,
    probe_slots: tokio::sync::Semaphore,
    pub(crate) cancel: tokio_util::sync::CancellationToken,
    pub(crate) tasks: tokio_util::task::TaskTracker,
    pub(crate) started: std::sync::atomic::AtomicBool,
    pub(crate) history_slots: Arc<tokio::sync::Semaphore>,
    pub(crate) in_flight: std::sync::Mutex<std::collections::HashSet<String>>,
    profile_http: reqwest::Client,
}
impl Operations {
    pub fn new(
        repo: Arc<dyn OperationsRepo>,
        servers: Arc<dyn ServerService>,
        files: Arc<dyn FileService>,
        properties: Arc<dyn PropertiesService>,
        exports: Arc<dyn ExportService>,
        connect_host: String,
    ) -> Result<Self, std::io::Error> {
        Ok(Self {
            repo,
            servers,
            files,
            properties,
            exports,
            connect_host,
            probe_slots: tokio::sync::Semaphore::new(4),
            cancel: tokio_util::sync::CancellationToken::new(),
            tasks: tokio_util::task::TaskTracker::new(),
            in_flight: std::sync::Mutex::default(),
            started: std::sync::atomic::AtomicBool::new(false),
            history_slots: Arc::new(tokio::sync::Semaphore::new(2)),
            profile_http: reqwest::Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .timeout(std::time::Duration::from_secs(5))
                .build()
                .map_err(std::io::Error::other)?,
        })
    }
    pub async fn shutdown(&self) {
        self.cancel.cancel();
        self.tasks.close();
        self.tasks.wait().await;
    }
}

#[async_trait]
impl OperationsService for Operations {
    async fn status(&self, id: &str) -> Result<GameStatus, OperationsError> {
        let _slot = self
            .probe_slots
            .try_acquire()
            .map_err(|_| OperationsError::Busy)?;
        let server = self.servers.get(id).await?;
        if server.server.archive.is_some() {
            return Ok(GameStatus {
                state: "archived".into(),
                observed_at: OffsetDateTime::now_utc()
                    .format(&Rfc3339)
                    .unwrap_or_default(),
                latency_ms: None,
                online_players: None,
                max_players: None,
                player_sample: vec![],
                version: None,
                connect_address: None,
                detail: "Restore this instance before starting Minecraft.".into(),
            });
        }
        let mut status = self.servers.game_status(id).await?;
        if status.connect_address.is_none() && !self.connect_host.is_empty() {
            let host = if self.connect_host.contains(':') && !self.connect_host.starts_with('[') {
                format!("[{}]", self.connect_host)
            } else {
                self.connect_host.clone()
            };
            status.connect_address = Some(format!("{host}:{}", server.server.port));
        }
        Ok(status)
    }
    async fn players(&self, id: &str) -> Result<PlayerLists, OperationsError> {
        self.player_lists(id).await
    }
    async fn change_player(
        &self,
        id: &str,
        change: PlayerChange,
    ) -> Result<PlayerLists, OperationsError> {
        self.apply_player_change(id, change).await
    }
    async fn automation(&self, id: &str) -> Result<AutomationState, OperationsError> {
        let server = self.servers.get(id).await?;
        Ok(self.repo.load(&server.server.id).await?)
    }
    async fn set_recovery(
        &self,
        id: &str,
        policy: RecoveryPolicy,
    ) -> Result<AutomationState, OperationsError> {
        if !(1..=10).contains(&policy.max_attempts)
            || !(5..=300).contains(&policy.retry_delay_seconds)
        {
            return Err(OperationsError::Invalid(
                "Use 1–10 restart attempts and a retry delay of 5–300 seconds.",
            ));
        }
        let server = self.servers.get(id).await?;
        let id = server.server.id.as_str();
        self.repo
            .patch(
                id,
                json!({"recovery":policy,"restartAttempts":0,"nextRetryAt":null,"intentAt":OffsetDateTime::now_utc().unix_timestamp_nanos() as i64,
            "desiredRunning":server.status.state==ServerState::Running}),
            )
            .await?;
        Ok(self.repo.load(id).await?)
    }
    async fn set_backup(
        &self,
        id: &str,
        request: BackupPolicyWrite,
    ) -> Result<AutomationState, OperationsError> {
        let server = self.servers.get(id).await?;
        let id = server.server.id.as_str();
        if !(1..=10080).contains(&request.interval_minutes)
            || request.keep_last.is_some_and(|n| !(1..=100).contains(&n))
        {
            return Err(OperationsError::Invalid(
                "Use a backup interval of 1–10080 minutes and keep 1–100 scheduled backups, or keep all.",
            ));
        }
        let old = self.repo.load(id).await?;
        if request.keep_last.is_some()
            && request.keep_last != old.backup.keep_last
            && !request.confirm_retention_deletion
        {
            return Err(OperationsError::Invalid(
                "Confirm deletion of older scheduled backups before enabling or changing retention.",
            ));
        }
        if request.enabled && !self.exports.storage().await?.configured {
            return Err(OperationsError::Invalid(
                "Configure S3 storage before enabling scheduled backups.",
            ));
        }
        let policy = BackupPolicy {
            enabled: request.enabled,
            interval_minutes: request.interval_minutes,
            keep_last: request.keep_last,
        };
        let next = policy.enabled.then(|| {
            OffsetDateTime::now_utc().unix_timestamp() + i64::from(policy.interval_minutes) * 60
        });
        self.repo
            .patch(
                id,
                json!({"backup":policy,"nextBackupAt":next,"lastBackupError":null}),
            )
            .await?;
        Ok(self.repo.load(id).await?)
    }
    async fn set_history(
        &self,
        id: &str,
        enabled: bool,
    ) -> Result<AutomationState, OperationsError> {
        let server = self.servers.get(id).await?;
        let id = server.server.id.as_str();
        self.repo
            .patch(id, json!({"historyEnabled":enabled}))
            .await?;
        Ok(self.repo.load(id).await?)
    }
    async fn history(&self, id: &str, hours: u32) -> Result<MetricsHistory, OperationsError> {
        if !(1..=168).contains(&hours) {
            return Err(OperationsError::Invalid(
                "History range must be 1–168 hours.",
            ));
        }
        let server = self.servers.get(id).await?;
        let id = server.server.id.as_str();
        let settings = self.repo.load(id).await?;
        let points = self
            .repo
            .history(
                id,
                OffsetDateTime::now_utc().unix_timestamp() - i64::from(hours) * 3600,
            )
            .await?;
        let resolution = (hours * 3600).div_ceil(720).max(60);
        let mut items = Vec::new();
        for bucket in points.chunk_by(|a, b| {
            a.sampled_at / i64::from(resolution) == b.sampled_at / i64::from(resolution)
        }) {
            let Some(first) = bucket.first() else {
                continue;
            };
            let cpu: Vec<f64> = bucket
                .iter()
                .filter_map(|p| p.cpu_percent)
                .filter(|n| n.is_finite())
                .collect();
            let memory: Vec<u64> = bucket
                .iter()
                .filter_map(|p| p.memory_working_set_bytes)
                .collect();
            items.push(HistoryPoint {
                sampled_at: first.sampled_at,
                cpu_percent: (!cpu.is_empty()).then(|| cpu.iter().sum::<f64>() / cpu.len() as f64),
                memory_working_set_bytes: (!memory.is_empty()).then(|| {
                    (memory.iter().map(|n| u128::from(*n)).sum::<u128>() / memory.len() as u128)
                        as u64
                }),
                memory_limit_bytes: bucket.iter().filter_map(|p| p.memory_limit_bytes).max(),
            });
        }
        // A range touching both edges of UTC-aligned buckets can contain one
        // extra partial bucket. Keep the newest bounded response.
        if items.len() > 720 {
            items = items.split_off(items.len() - 720);
        }
        Ok(MetricsHistory {
            enabled: settings.history_enabled,
            interval_seconds: 60,
            retention_days: 7,
            resolution_seconds: resolution,
            items,
        })
    }
}
