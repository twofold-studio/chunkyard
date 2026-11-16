//! One bounded scheduler, opt-in recovery and stopped-only verified S3 backups.
use super::Operations;
use chunkyard_core::{
    jobs::{JobFailure, JobService},
    operations::*,
    server::ServerState,
};
use serde_json::json;
use std::{
    collections::HashSet,
    sync::{Arc, Weak},
    time::Duration,
};
use time::OffsetDateTime;

pub(super) struct Lease {
    owner: Weak<Operations>,
    id: String,
}
impl Drop for Lease {
    fn drop(&mut self) {
        if let Some(owner) = self.owner.upgrade() {
            owner
                .in_flight
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .remove(&self.id);
        }
    }
}
pub(super) fn failure(error: OperationsError) -> JobFailure {
    JobFailure {
        code: error.code().into(),
        detail: error.public_detail().into(),
    }
}
impl Operations {
    pub(super) fn reserve(self: &Arc<Self>, id: &str) -> Option<Lease> {
        if !self
            .in_flight
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .insert(id.into())
        {
            return None;
        }
        Some(Lease {
            owner: Arc::downgrade(self),
            id: id.into(),
        })
    }
    pub fn start(self: &Arc<Self>, jobs: Arc<dyn JobService>) {
        if self.started.swap(true, std::sync::atomic::Ordering::AcqRel) {
            return;
        }
        let owner = self.clone();
        let started_at = OffsetDateTime::now_utc().unix_timestamp_nanos() as i64;
        self.tasks.spawn(async move {
            let mut ticker = tokio::time::interval(Duration::from_secs(5));
            ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            let mut boot: Option<HashSet<String>> = None;
            let mut last_prune = 0;
            loop {
                tokio::select! {
                    _ = owner.cancel.cancelled() => break,
                    _ = ticker.tick() => {}
                }
                let now = OffsetDateTime::now_utc().unix_timestamp();
                let Ok(records) = owner.servers.records().await else {
                    continue;
                };
                let pending = boot.get_or_insert_with(|| {
                    records.iter().map(|server| server.id.clone()).collect()
                });
                for record in records {
                    if owner.cancel.is_cancelled() {
                        break;
                    }
                    let id = record.id;
                    if record.archive.is_some() {
                        pending.remove(&id);
                        continue;
                    }
                    let Ok(state) = owner.repo.load(&id).await else {
                        continue;
                    };
                    owner.reconcile_backup_job(&id, &state, jobs.as_ref()).await;
                    let history_due = state.history_enabled
                        && state.last_history_at.is_none_or(|last| now - last >= 60);
                    let boot_candidate = pending.contains(&id)
                        && state.recovery.auto_start
                        && state.intent_at <= started_at;
                    if !boot_candidate {
                        pending.remove(&id);
                    }
                    let backup_due = state.backup.enabled
                        && state.next_backup_at.is_some_and(|at| now >= at);
                    if !history_due && !boot_candidate && !backup_due
                        && !(state.recovery.restart_on_crash && state.desired_running)
                    {
                        continue;
                    }
                    // Persist attempts even when Docker is busy to avoid a hot retry loop.
                    if history_due {
                        let _ = owner.repo.patch(&id, json!({ "lastHistoryAt": now })).await;
                    }
                    let Ok(server) = owner.servers.get(&id).await else {
                        continue;
                    };
                    if history_due && server.status.state == ServerState::Running {
                        owner.collect_history(&id);
                    }
                    let boot_start = boot_candidate && server.status.state == ServerState::Stopped;
                    if server.status.state != ServerState::Unknown && !boot_start {
                        pending.remove(&id);
                    }
                    let crashed = server.status.state == ServerState::Stopped
                        && (server.status.oom_killed
                            || server.status.exit_code.is_some_and(|code| code != 0));
                    if owner.schedule_retry(&id, &state, crashed, now).await {
                        continue;
                    }
                    let retry = crashed && state.desired_running && state.recovery.restart_on_crash
                        && state.restart_attempts < state.recovery.max_attempts
                        && state.next_retry_at.is_none_or(|at| now >= at);
                    let active = jobs.list_filtered(1, None, Some(&id), true).await;
                    if !active.as_ref().is_ok_and(|page| page.items.is_empty()) {
                        continue;
                    }
                    if boot_start || retry {
                        match owner.queue_start(&id, state.clone(), boot_start, now, jobs.clone()).await {
                            Ok(()) => { pending.remove(&id); }
                            Err(error) => tracing::warn!(%error, server_id = %id, "automatic start could not be queued"),
                        }
                        continue;
                    }
                    owner.track_stability(&id, &state, &server.status.state, now).await;
                    if backup_due
                        && let Err(error) = owner.queue_backup(&server, state, now, jobs.clone()).await
                    {
                        tracing::warn!(%error, server_id = %id, "scheduled backup could not be queued");
                    }
                }
                if now - last_prune >= 60 {
                    if let Err(error) = owner.repo.prune_history(now - 7 * 86400).await {
                        tracing::warn!(%error, "could not prune bounded metrics history");
                    }
                    last_prune = now;
                }
            }
        });
    }
}
