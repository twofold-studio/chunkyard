use super::{Operations, worker::failure};
use chunkyard_core::{
    jobs::{JobFailure, JobService},
    operations::*,
};
use serde_json::json;
use std::sync::Arc;

impl Operations {
    pub(super) async fn schedule_retry(
        &self,
        id: &str,
        state: &AutomationState,
        crashed: bool,
        now: i64,
    ) -> bool {
        if crashed
            && state.desired_running
            && state.recovery.restart_on_crash
            && state.restart_attempts < state.recovery.max_attempts
            && state.next_retry_at.is_none()
        {
            let patch = json!({
                "nextRetryAt": now + i64::from(state.recovery.retry_delay_seconds),
                "stableSince": null
            });
            let _ = self.repo.patch_if_running(id, patch).await;
            return true;
        }
        false
    }

    pub(super) async fn track_stability(
        &self,
        id: &str,
        state: &AutomationState,
        status: &chunkyard_core::server::ServerState,
        now: i64,
    ) {
        use chunkyard_core::server::ServerState;
        if *status == ServerState::Running {
            if state.next_retry_at.is_some() {
                let _ = self
                    .repo
                    .patch(
                        id,
                        json!({
                            "nextRetryAt": null
                        }),
                    )
                    .await;
            }
            if let Some(since) = state.stable_since {
                if now - since >= 300 && state.restart_attempts > 0 {
                    let _ = self
                        .repo
                        .patch(
                            id,
                            json!({
                                "restartAttempts": 0,
                                "nextRetryAt": null
                            }),
                        )
                        .await;
                }
            } else {
                let _ = self
                    .repo
                    .patch(
                        id,
                        json!({
                            "stableSince": now
                        }),
                    )
                    .await;
            }
        } else if state.stable_since.is_some() {
            let _ = self
                .repo
                .patch(
                    id,
                    json!({
                        "stableSince": null
                    }),
                )
                .await;
        }
    }

    pub(super) async fn queue_start(
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
                json!({
                    "desiredRunning": true,
                    "restartAttempts": attempts,
                    "stableSince": null,
                    "nextRetryAt": now+i64::from(state.recovery.retry_delay_seconds)
                }),
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
            Ok(json!({
                "server": server,
                "automatic": true
            }))
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
            self.repo
                .patch_if_running(
                    id,
                    json!({
                        "restartAttempts": state.restart_attempts,
                        "desiredRunning": state.desired_running,
                        "nextRetryAt": now+5
                    }),
                )
                .await?;
            return Err(OperationsError::Busy);
        }
        Ok(())
    }
}
