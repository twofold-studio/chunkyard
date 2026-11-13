use async_trait::async_trait;
use mcm_core::software::*;
use serde_json::{Value, json};
use std::{
    path::Path,
    sync::atomic::{AtomicBool, Ordering},
};
#[derive(Default)]
pub struct FakeSoftware {
    failed_once: AtomicBool,
}
#[async_trait]
impl SoftwareService for FakeSoftware {
    fn catalog(&self) -> Value {
        json!({"items":[{"id":"vanilla","name":"Vanilla","available":true,"reason":null},{"id":"paper","name":"Paper","available":true,"reason":null},{"id":"custom","name":"Custom JAR","available":true,"reason":null}]})
    }
    async fn versions(&self, kind: &str) -> Result<Value, SoftwareError> {
        if !matches!(kind, "vanilla" | "paper") {
            return Err(SoftwareError::Invalid);
        }
        Ok(json!({"items":[{"id":"1.21.4","stable":true}]}))
    }
    async fn builds(&self, kind: &str, version: &str) -> Result<Value, SoftwareError> {
        component(version)?;
        if kind != "paper" {
            return Err(SoftwareError::Invalid);
        }
        Ok(json!({"items":[{"id":"232","stable":true}]}))
    }
    async fn prepare(
        &self,
        software: &Software,
        directory: &Path,
    ) -> Result<Launch, SoftwareError> {
        tokio::fs::write(directory.join("server.jar"), "fixture")
            .await
            .map_err(|_| SoftwareError::Filesystem)?;
        if software.version() == "retry" && !self.failed_once.swap(true, Ordering::SeqCst) {
            return Err(SoftwareError::Download);
        }
        Ok(Launch {
            path: "server.jar".into(),
            version: software.version().into(),
            build: match software {
                Software::Paper { build, .. } => Some(build.clone().unwrap_or("232".into())),
                _ => None,
            },
            java_major: 21,
            checksum: "fixture".into(),
        })
    }
}
