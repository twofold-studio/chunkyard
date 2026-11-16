//! Bounded history collection independent of automatic lifecycle and backup jobs.
use super::Operations;
use chunkyard_core::operations::HistoryPoint;
use std::sync::Arc;
use time::{OffsetDateTime, format_description::well_known::Rfc3339};

impl Operations {
    pub(super) fn collect_history(self: &Arc<Self>, id: &str) {
        let Ok(permit) = self.history_slots.clone().try_acquire_owned() else {
            return;
        };
        let collector = self.clone();
        let sample_id = id.to_owned();
        self.tasks.spawn(async move {
            let _permit = permit;
            if collector.cancel.is_cancelled() {
                return;
            }
            if !collector
                .repo
                .load(&sample_id)
                .await
                .is_ok_and(|state| state.history_enabled)
            {
                return;
            }
            if let Ok(sample) = collector.servers.metrics(&sample_id).await
                && let Ok(time) = OffsetDateTime::parse(&sample.sampled_at, &Rfc3339)
            {
                let point = HistoryPoint {
                    sampled_at: time.unix_timestamp(),
                    cpu_percent: sample.cpu_percent,
                    memory_working_set_bytes: sample.memory_working_set_bytes,
                    memory_limit_bytes: sample.memory_limit_bytes,
                };
                if let Err(error) = collector.repo.metric(&sample_id, &point).await {
                    tracing::warn!(%error, "could not persist a metrics snapshot");
                }
            }
        });
    }
}
