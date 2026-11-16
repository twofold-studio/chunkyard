use super::{Operations, worker::failure};
use chunkyard_core::{
    exports::{ExportDestination, ExportRequest, ExportScope},
    jobs::JobService,
    operations::*,
    progress::ProgressReporter,
    server::{ServerState, ServerView},
};
use serde_json::{Value, json};
use std::sync::Arc;

impl Operations {
    pub(super) async fn reconcile_backup_job(
        &self,
        id: &str,
        state: &AutomationState,
        jobs: &dyn JobService,
    ) {
        use chunkyard_core::jobs::JobState;
        if state.last_backup_result.as_deref() == Some("queued")
            && let Some(job_id) = &state.last_backup_job
            && let Ok(Some(job)) = jobs.get(job_id).await
            && matches!(job.state, JobState::Failed | JobState::Cancelled)
        {
            let _ = self.repo.patch(id, json!({
                "lastBackupResult": "failed",
                "lastBackupError": "The scheduled backup did not finish. See its job for details; existing backups were retained."
            })).await;
        }
    }

    pub(super) async fn queue_backup(
        self: &Arc<Self>,
        server: &ServerView,
        state: AutomationState,
        now: i64,
        jobs: Arc<dyn JobService>,
    ) -> Result<(), OperationsError> {
        let id = &server.server.id;
        let next = now + i64::from(state.backup.interval_minutes) * 60;
        if server.status.state != ServerState::Stopped {
            self.repo.patch(id,json!({
                "nextBackupAt": next,
                "lastBackupResult": "skipped_running",
                "lastBackupError": "Scheduled backups require a stopped instance; no server was stopped automatically."
            })).await?;
            return Ok(());
        }
        let Some(lease) = self.reserve(id) else {
            return Ok(());
        };
        self.repo
            .patch(
                id,
                json!({
                    "nextBackupAt": next,
                    "lastBackupResult": "queued",
                    "lastBackupError": null
                }),
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
                let _ = owner
                    .repo
                    .patch(
                        &server_id,
                        json!({
                            "lastBackupResult": "failed",
                            "lastBackupError": error.public_detail()
                        }),
                    )
                    .await;
            }
            result.map_err(failure)
        });
        match jobs
            .submit_progress_for_server("server.backup_scheduled", id, None, task, progress)
            .await
        {
            Ok(job) => {
                self.repo
                    .patch(
                        id,
                        json!({
                            "lastBackupJob": job.id
                        }),
                    )
                    .await?;
            }
            Err(_) => {
                self.repo
                    .patch(
                        id,
                        json!({
                            "nextBackupAt": now+60,
                            "lastBackupResult": "busy",
                            "lastBackupError": "Job capacity was busy; retrying in one minute."
                        }),
                    )
                    .await?;
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
        self.repo
            .patch(
                id,
                json!({
                    "lastBackupAt": now,
                    "lastBackupExportId": export.id,
                    "lastBackupResult": "succeeded",
                    "lastBackupError": null
                }),
            )
            .await?;
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
                    Err(chunkyard_core::exports::ExportError::NotFound) => {
                        self.repo.forget_backup(&old).await?;
                        continue;
                    }
                    Err(error) => {
                        self.repo.patch(id,json!({
                            "lastBackupError": format!("Backup verified; retention lookup did not finish: {}", error.public_detail())
                        })).await?;
                        break;
                    }
                }
                match self.exports.delete(&old).await {
                    Ok(()) => {
                        self.repo.forget_backup(&old).await?;
                        deleted += 1;
                    }
                    Err(chunkyard_core::exports::ExportError::BackupRequired) => {}
                    Err(chunkyard_core::exports::ExportError::NotFound) => {
                        self.repo.forget_backup(&old).await?;
                    }
                    Err(error) => {
                        self.repo.patch(id,json!({
                            "lastBackupError": format!("Backup verified; retention did not finish: {}", error.public_detail())
                        })).await?;
                        break;
                    }
                }
            }
        }
        Ok(json!({
            "export": export,
            "scheduled": true,
            "retentionDeleted": deleted
        }))
    }
}
