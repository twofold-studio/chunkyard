//! One bounded scheduler, opt-in recovery and stopped-only verified S3 backups.
use super::Operations;
use mcm_core::{
    exports::{ExportDestination, ExportRequest, ExportScope},
    jobs::{JobFailure, JobService},
    operations::*,
    progress::ProgressReporter,
    server::{ServerState, ServerView},
};
use serde_json::{Value, json};
use std::{
    collections::HashSet,
    sync::{Arc, Weak},
    time::Duration,
};
use time::{OffsetDateTime, format_description::well_known::Rfc3339};

struct Lease {
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
fn failure(error: OperationsError) -> JobFailure {
    JobFailure {
        code: error.code().into(),
        detail: error.public_detail().into(),
    }
}
impl Operations {
    fn reserve(self: &Arc<Self>, id: &str) -> Option<Lease> {
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
            let mut ticker=tokio::time::interval(Duration::from_secs(5));
            ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            let mut boot:Option<HashSet<String>>=None;
            let mut last_prune=0;
            loop {
                tokio::select! {_=owner.cancel.cancelled()=>break,_=ticker.tick()=>{}}
                let now=OffsetDateTime::now_utc().unix_timestamp();
                let Ok(records)=owner.servers.records().await else {continue;};
                let pending=boot.get_or_insert_with(||records.iter().map(|s|s.id.clone()).collect());
                for record in records {
                    if owner.cancel.is_cancelled() {break;}
                    let id=record.id.clone();
                    if record.archive.is_some() {pending.remove(&id);continue;}
                    let Ok(state)=owner.repo.load(&id).await else {continue;};
                    if state.last_backup_result.as_deref()==Some("queued")
                        && let Some(job_id)=&state.last_backup_job
                        && let Ok(Some(job))=jobs.get(job_id).await
                        && matches!(job.state,mcm_core::jobs::JobState::Failed|mcm_core::jobs::JobState::Cancelled) {
                        let _=owner.repo.patch(&id,json!({"lastBackupResult":"failed","lastBackupError":"The scheduled backup did not finish. See its job for details; existing backups were retained."})).await;
                    }
                    let history_due=state.history_enabled&&state.last_history_at.is_none_or(|last|now-last>=60);
                    let boot_candidate=pending.contains(&id)&&state.recovery.auto_start&&state.intent_at<=started_at;
                    if !boot_candidate {pending.remove(&id);}
                    let backup_due=state.backup.enabled&&state.next_backup_at.is_some_and(|at|now>=at);
                    if !history_due&&!boot_candidate&&!backup_due&&!(state.recovery.restart_on_crash&&state.desired_running) {continue;}
                    if history_due {let _=owner.repo.patch(&id,json!({"lastHistoryAt":now})).await;}
                    let Ok(server)=owner.servers.get(&id).await else {continue;};
                    if history_due && server.status.state==ServerState::Running
                        && let Ok(permit)=owner.history_slots.clone().try_acquire_owned() {
                        // Persist the attempt time too: busy Docker must not create a hot retry loop.
                        let collector=owner.clone();let sample_id=id.clone();
                        owner.tasks.spawn(async move {
                            let _permit=permit;
                            if collector.cancel.is_cancelled() {return;}
                            if !collector.repo.load(&sample_id).await.is_ok_and(|state|state.history_enabled) {return;}
                            if let Ok(sample)=collector.servers.metrics(&sample_id).await
                                && let Ok(time)=OffsetDateTime::parse(&sample.sampled_at,&Rfc3339) {
                                let point=HistoryPoint {sampled_at:time.unix_timestamp(),cpu_percent:sample.cpu_percent,
                                    memory_working_set_bytes:sample.memory_working_set_bytes,memory_limit_bytes:sample.memory_limit_bytes};
                                if let Err(error)=collector.repo.metric(&sample_id,&point).await {tracing::warn!(%error,"could not persist a metrics snapshot");}
                            }
                        });
                    }
                    let boot_start=boot_candidate&&server.status.state==ServerState::Stopped;
                    if server.status.state!=ServerState::Unknown && !boot_start {pending.remove(&id);}
                    let crashed=server.status.state==ServerState::Stopped
                        && (server.status.oom_killed||server.status.exit_code.is_some_and(|code|code!=0));
                    if crashed&&state.desired_running&&state.recovery.restart_on_crash
                        &&state.restart_attempts<state.recovery.max_attempts&&state.next_retry_at.is_none() {
                        let _=owner.repo.patch_if_running(&id,json!({"nextRetryAt":now+i64::from(state.recovery.retry_delay_seconds),"stableSince":null})).await;
                        continue;
                    }
                    let retry=crashed&&state.desired_running&&state.recovery.restart_on_crash
                        && state.restart_attempts<state.recovery.max_attempts&&state.next_retry_at.is_none_or(|at|now>=at);
                    let active=jobs.list_filtered(1,None,Some(&id),true).await;
                    if !active.as_ref().is_ok_and(|page|page.items.is_empty()) {continue;}
                    if boot_start || retry {
                        match owner.queue_start(&id,state.clone(),boot_start,now,jobs.clone()).await {
                            Ok(())=>{pending.remove(&id);},
                            Err(error)=>tracing::warn!(%error,server_id=%id,"automatic start could not be queued"),
                        }
                        continue;
                    }
                    if server.status.state==ServerState::Running {
                        if state.next_retry_at.is_some() {let _=owner.repo.patch(&id,json!({"nextRetryAt":null})).await;}
                        if let Some(since)=state.stable_since {
                            if now-since>=300&&state.restart_attempts>0 {
                                let _=owner.repo.patch(&id,json!({"restartAttempts":0,"nextRetryAt":null})).await;
                            }
                        } else {let _=owner.repo.patch(&id,json!({"stableSince":now})).await;}
                    } else if state.stable_since.is_some() {let _=owner.repo.patch(&id,json!({"stableSince":null})).await;}
                    if state.backup.enabled&&state.next_backup_at.is_some_and(|at|now>=at)
                        && let Err(error)=owner.queue_backup(&server,state,now,jobs.clone()).await {
                        tracing::warn!(%error,server_id=%id,"scheduled backup could not be queued");
                    }
                }
                if now-last_prune>=60 {
                    if let Err(error)=owner.repo.prune_history(now-7*86400).await {tracing::warn!(%error,"could not prune bounded metrics history");}
                    last_prune=now;
                }
            }
        });
    }
    async fn queue_start(
        self: &Arc<Self>,
        id: &str,
        state: AutomationState,
        boot: bool,
        now: i64,
        jobs: Arc<dyn JobService>,
    ) -> Result<(), OperationsError> {
        let Some(lease) = self.reserve(id) else {
            return Ok(());
        };
        let attempts = if boot {
            1
        } else {
            state.restart_attempts.saturating_add(1)
        };
        if !self
            .repo
            .claim_start(
                id,
                state.intent_at,
                json!({"desiredRunning":true,"restartAttempts":attempts,"stableSince":null,
            "nextRetryAt":now+i64::from(state.recovery.retry_delay_seconds)}),
            )
            .await?
        {
            return Ok(());
        }
        let owner = self.clone();
        let server_id = id.to_owned();
        let task = Box::pin(async move {
            let _lease = lease;
            let current = owner
                .repo
                .load(&server_id)
                .await
                .map_err(OperationsError::from)
                .map_err(failure)?;
            if owner.cancel.is_cancelled()
                || !current.desired_running
                || !(if boot {
                    current.recovery.auto_start
                } else {
                    current.recovery.restart_on_crash
                })
            {
                return Err(JobFailure {
                    code: "recovery.superseded".into(),
                    detail: "A newer stop or policy change superseded automatic recovery.".into(),
                });
            }
            let server = owner
                .servers
                .automatic_start(&server_id)
                .await
                .map_err(OperationsError::from)
                .map_err(failure)?;
            Ok(json!({"server":server,"automatic":true}))
        });
        if jobs
            .submit_for_server(
                if boot {
                    "server.auto_start"
                } else {
                    "server.recover"
                },
                id,
                None,
                task,
            )
            .await
            .is_err()
        {
            self.repo.patch_if_running(id,json!({"restartAttempts":state.restart_attempts,"desiredRunning":state.desired_running,"nextRetryAt":now+5})).await?;
            return Err(OperationsError::Busy);
        }
        Ok(())
    }
    async fn queue_backup(
        self: &Arc<Self>,
        server: &ServerView,
        state: AutomationState,
        now: i64,
        jobs: Arc<dyn JobService>,
    ) -> Result<(), OperationsError> {
        let id = &server.server.id;
        let next = now + i64::from(state.backup.interval_minutes) * 60;
        if server.status.state != ServerState::Stopped {
            self.repo.patch(id,json!({"nextBackupAt":next,"lastBackupResult":"skipped_running", "lastBackupError":"Scheduled backups require a stopped instance; no server was stopped automatically."})).await?;
            return Ok(());
        }
        let Some(lease) = self.reserve(id) else {
            return Ok(());
        };
        self.repo
            .patch(
                id,
                json!({"nextBackupAt":next,"lastBackupResult":"queued","lastBackupError":null}),
            )
            .await?;
        let owner = self.clone();
        let server_id = id.to_owned();
        let progress = ProgressReporter::default();
        let report = progress.clone();
        let task = Box::pin(async move {
            let _lease = lease;
            let result = owner.backup(&server_id, now, report).await;
            if let Err(error) = &result {
                let _=owner.repo.patch(&server_id,json!({"lastBackupResult":"failed","lastBackupError":error.public_detail()})).await;
            }
            result.map_err(failure)
        });
        match jobs
            .submit_progress_for_server("server.backup_scheduled", id, None, task, progress)
            .await
        {
            Ok(job) => {
                self.repo.patch(id, json!({"lastBackupJob":job.id})).await?;
            }
            Err(_) => {
                self.repo.patch(id,json!({"nextBackupAt":now+60,"lastBackupResult":"busy","lastBackupError":"Job capacity was busy; retrying in one minute."})).await?;
            }
        }
        Ok(())
    }
    async fn backup(
        &self,
        id: &str,
        now: i64,
        progress: ProgressReporter,
    ) -> Result<Value, OperationsError> {
        if self.cancel.is_cancelled() {
            return Err(OperationsError::Busy);
        }
        let current = self.repo.load(id).await?;
        if !current.backup.enabled {
            return Err(OperationsError::Invalid(
                "Scheduled backups were disabled before this job started.",
            ));
        }
        let export = self
            .exports
            .create_with_progress(
                id,
                ExportRequest {
                    scope: ExportScope::All,
                    paths: vec![],
                    destination: ExportDestination::S3,
                },
                progress,
            )
            .await?;
        self.repo.remember_backup(id, &export.id, now).await?;
        self.repo.patch(id,json!({"lastBackupAt":now,"lastBackupExportId":export.id,"lastBackupResult":"succeeded","lastBackupError":null})).await?;
        let mut deleted = 0;
        if let Some(keep) = self.repo.load(id).await?.backup.keep_last {
            // This registry contains only backups created by this scheduler. Manual
            // exports are never candidates; ExportService protects pinned restore points.
            for old in self
                .repo
                .scheduled_backups(id)
                .await?
                .into_iter()
                .skip(keep as usize)
            {
                match self.exports.get(&old).await {
                    Ok(candidate)
                        if candidate.server_id == id
                            && matches!(candidate.scope, ExportScope::All)
                            && matches!(candidate.destination, ExportDestination::S3) => {}
                    Ok(_) => continue,
                    Err(mcm_core::exports::ExportError::NotFound) => {
                        self.repo.forget_backup(&old).await?;
                        continue;
                    }
                    Err(error) => {
                        self.repo.patch(id,json!({"lastBackupError":format!("Backup verified; retention lookup did not finish: {}",error.public_detail())})).await?;
                        break;
                    }
                }
                match self.exports.delete(&old).await {
                    Ok(()) => {
                        self.repo.forget_backup(&old).await?;
                        deleted += 1;
                    }
                    Err(mcm_core::exports::ExportError::BackupRequired) => {}
                    Err(mcm_core::exports::ExportError::NotFound) => {
                        self.repo.forget_backup(&old).await?;
                    }
                    Err(error) => {
                        self.repo.patch(id,json!({"lastBackupError":format!("Backup verified; retention did not finish: {}",error.public_detail())})).await?;
                        break;
                    }
                }
            }
        }
        Ok(json!({"export":export,"scheduled":true,"retentionDeleted":deleted}))
    }
}
