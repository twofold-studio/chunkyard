//! Bounded, coalesced observations of real work. Percentages apply to a stage only.
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Stage {
    Resolve,
    Download,
    Verify,
    Extract,
    PrepareLoader,
    Finalize,
    Scan,
    Compress,
    Upload,
    VerifyUpload,
    FetchArchive,
    VerifyArchive,
    Restore,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkProgress {
    pub stage: Stage,
    pub completed_bytes: Option<u64>,
    pub total_bytes: Option<u64>,
    pub completed_stages: Vec<Stage>,
}

#[derive(Clone, Default)]
pub struct ProgressReporter(Arc<Mutex<Option<WorkProgress>>>);
impl ProgressReporter {
    pub fn stage(&self, stage: Stage) {
        self.bytes(stage, None, None);
    }
    pub fn bytes(&self, stage: Stage, completed: Option<u64>, total: Option<u64>) {
        let Ok(mut current) = self.0.lock() else {
            return;
        };
        let work = current.get_or_insert_with(|| WorkProgress {
            stage,
            completed_bytes: None,
            total_bytes: None,
            completed_stages: Vec::new(),
        });
        if work.stage != stage {
            if work.completed_stages.len() == 32 {
                work.completed_stages.remove(0);
            }
            work.completed_stages.push(work.stage);
        }
        work.stage = stage;
        work.completed_bytes = completed;
        work.total_bytes =
            total.filter(|total| *total > 0 && completed.is_none_or(|done| done <= *total));
    }
    pub fn snapshot(&self) -> Option<WorkProgress> {
        self.0.lock().ok()?.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn unknown_totals_stay_unknown_and_history_is_bounded() {
        let progress = ProgressReporter::default();
        progress.bytes(Stage::Compress, Some(123), None);
        assert_eq!(progress.snapshot().map(|w| w.total_bytes), Some(None));
        progress.bytes(Stage::Upload, Some(100), Some(10));
        assert_eq!(progress.snapshot().map(|w| w.total_bytes), Some(None));
        for _ in 0..100 {
            progress.stage(Stage::Download);
            progress.stage(Stage::Verify);
        }
        assert_eq!(
            progress.snapshot().map(|w| w.completed_stages.len()),
            Some(32)
        );
    }
}
