#![allow(dead_code)]
mod runtime;
use async_trait::async_trait;
use mcm_core::java::{
    AvailableJava, JavaRuntime, JavaRuntimeId, JavaRuntimeService, JavaServiceError,
};
use mcm_server::wiring::{Backend, build_state};
use serde_json::{Value, json};
use std::{error::Error, sync::Arc};
use tokio::sync::oneshot;
use uuid::Uuid;

pub struct TestApp {
    pub backend: Backend,
    pub client: reqwest::Client,
    pub base: String,
    pub directory: tempfile::TempDir,
    stop: Option<oneshot::Sender<()>>,
    server: tokio::task::JoinHandle<Result<(), std::io::Error>>,
}
impl TestApp {
    pub async fn new() -> Result<Self, Box<dyn Error>> {
        Self::with_options(true, false).await
    }
    pub async fn with_options(discover: bool, fail_install: bool) -> Result<Self, Box<dyn Error>> {
        Self::with_settings(discover, fail_install, true, false, true).await
    }
    pub async fn with_auth(enabled: bool) -> Result<Self, Box<dyn Error>> {
        Self::with_settings(true, false, enabled, false, true).await
    }
    pub async fn with_ui() -> Result<Self, Box<dyn Error>> {
        Self::with_settings(true, false, false, true, true).await
    }
    pub async fn with_version(enabled: bool) -> Result<Self, Box<dyn Error>> {
        Self::with_settings(true, false, true, false, enabled).await
    }
    async fn with_settings(
        discover: bool,
        fail_install: bool,
        auth_enabled: bool,
        ui: bool,
        show_version: bool,
    ) -> Result<Self, Box<dyn Error>> {
        let directory = tempfile::tempdir()?;
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
        let address = listener.local_addr()?;
        let mut config = mcm_config::Config {
            data_dir: directory.path().to_owned(),
            ..Default::default()
        };
        config.http.listen = address;
        config.http.show_version = show_version;
        config.auth.enabled = auth_enabled;
        config.java.allow_system_java = discover;
        let mut backend = build_state(&config).await?;
        backend.state.java = Arc::new(FakeJava { fail_install });
        backend.state.servers = Arc::new(mcm_process::ServerManager::new(
            directory.path().join("servers"),
            "fixture-image".into(),
            Arc::new(mcm_db::SqliteServerRepo::new(&backend.database)),
            Arc::new(runtime::FakeRuntime::default()),
        ));
        let base = format!("http://{address}");
        let router = if ui {
            let assets = directory.path().join("ui");
            std::fs::create_dir_all(assets.join("_app/immutable"))?;
            std::fs::write(
                assets.join("200.html"),
                "<!doctype html><html><body><script>window.test=1;</script></body></html>",
            )?;
            std::fs::write(
                assets.join("_app/immutable/test.ABC.js"),
                "export const test=1;",
            )?;
            std::fs::write(assets.join("robots.txt"), "User-agent: *")?;
            mcm_server::ui::router(backend.state.clone(), Some(&assets)).await?
        } else {
            mcm_api::router(backend.state.clone())
        };
        let app = router.into_make_service_with_connect_info::<std::net::SocketAddr>();
        let (stop, receiver) = oneshot::channel();
        let server = tokio::spawn(async move {
            axum::serve(listener, app)
                .with_graceful_shutdown(async {
                    let _ = receiver.await;
                })
                .await
        });
        let client = reqwest::Client::builder()
            .no_proxy()
            .cookie_store(true)
            .build()?;
        Ok(Self {
            backend,
            client,
            base,
            directory,
            stop: Some(stop),
            server,
        })
    }
    pub fn post(&self, path: &str) -> reqwest::RequestBuilder {
        self.client
            .post(format!("{}{path}", self.base))
            .header("Origin", &self.base)
            .header("X-MCM-CSRF", "1")
    }
    pub async fn setup(&self) -> Result<Value, Box<dyn Error>> {
        let token = tokio::fs::read_to_string(self.directory.path().join("setup-token")).await?;
        let response = self.post("/api/v1/setup").json(&json!({"setupToken":token, "email":"owner@example.com", "password":"correct horse battery staple"})).send().await?;
        assert_eq!(response.status(), 201);
        Ok(response.json().await?)
    }
    pub async fn close(mut self) -> Result<(), Box<dyn Error>> {
        if let Some(stop) = self.stop.take() {
            let _ = stop.send(());
        }
        self.server.await??;
        self.backend.shutdown().await;
        Ok(())
    }
}
struct FakeJava {
    fail_install: bool,
}
#[async_trait]
impl JavaRuntimeService for FakeJava {
    async fn list(&self) -> Result<Vec<JavaRuntime>, JavaServiceError> {
        Ok(vec![JavaRuntime {
            id: JavaRuntimeId(Uuid::nil()),
            vendor: "Test Vendor".into(),
            major: 21,
            full_version: "21.0.10".into(),
            os: "linux".into(),
            arch: "x64".into(),
            path: "/test/java".into(),
            managed: false,
            sha256: None,
        }])
    }
    async fn discover(&self) -> Result<Vec<JavaRuntime>, JavaServiceError> {
        self.list().await
    }
    async fn available(&self) -> Result<AvailableJava, JavaServiceError> {
        Ok(AvailableJava {
            lts: vec![8, 17, 21],
            all: vec![8, 17, 21],
            most_recent_lts: 21,
        })
    }
    async fn install(&self, _: u16) -> Result<JavaRuntime, JavaServiceError> {
        if self.fail_install {
            return Err(JavaServiceError {
                code: "download.failed",
                detail: "The Java provider request failed.",
            });
        }
        self.list().await?.pop().ok_or(JavaServiceError {
            code: "internal",
            detail: "missing fixture",
        })
    }
}
