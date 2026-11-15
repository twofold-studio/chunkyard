use async_trait::async_trait;
use chunkyard_core::software::*;
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
    async fn prepare_plan(
        &self,
        software: &Software,
        directory: &Path,
        options: &chunkyard_core::software::InstallOptions,
        _lease: std::sync::Arc<dyn Send + Sync>,
    ) -> Result<chunkyard_core::software::PreparedSoftware, SoftwareError> {
        use chunkyard_core::software::*;
        if matches!(software, Software::CurseForge { .. }) {
            let pack = directory.join("pack");
            std::fs::create_dir_all(pack.join("mods")).map_err(|_| SoftwareError::Filesystem)?;
            std::fs::write(pack.join("fixture.jar"), "fixture")
                .map_err(|_| SoftwareError::Filesystem)?;
            std::fs::write(pack.join("mods/mod.jar"), "server-side fixture mod")
                .map_err(|_| SoftwareError::Filesystem)?;
            std::fs::write(
                pack.join("server.properties"),
                "enable-command-block=true\nallow-flight=true\nmotd=pack default\n",
            )
            .map_err(|_| SoftwareError::Filesystem)?;
            std::fs::write(pack.join("eula.txt"), "eula=true\n")
                .map_err(|_| SoftwareError::Filesystem)?;
            return Ok(PreparedSoftware {
                launch: Launch {
                    path: "fixture.jar".into(),
                    version: options
                        .minecraft_version
                        .clone()
                        .unwrap_or_else(|| "1.20.1".into()),
                    java_major: options.java_major.unwrap_or(17),
                    build: None,
                    checksum: "0".repeat(64),
                    profile: None,
                    loader: Some(Loader {
                        r#type: LoaderType::Forge,
                        version: "47.4.0".into(),
                    }),
                },
                installer: None,
                instance_files: true,
            });
        }
        Ok(PreparedSoftware {
            launch: self.prepare(software, directory).await?,
            installer: None,
            instance_files: false,
        })
    }
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
            profile: None,
            loader: None,
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
