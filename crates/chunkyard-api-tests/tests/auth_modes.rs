mod common;
use common::TestApp;
use serde_json::{Value, json};
type Result<T = ()> = std::result::Result<T, Box<dyn std::error::Error>>;

#[tokio::test]
async fn disabled_auth_skips_setup_and_allows_inventory_and_jobs_without_an_account() -> Result {
    let app = TestApp::with_auth(false).await?;
    let status: Value = app
        .client
        .get(format!("{}/api/v1/setup/status", app.base))
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    assert_eq!(status, json!({"authEnabled":false, "required":false}));
    assert!(!app.directory.path().join("setup-token").exists());
    assert!(app.backend.state.auth.setup_required().await?);
    let me: Value = app
        .client
        .get(format!("{}/api/v1/auth/me", app.base))
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    assert_eq!(me["principal"]["kind"], "auth_disabled");
    assert!(me["user"].is_null());
    assert_eq!(
        app.client
            .get(format!("{}/api/v1/servers", app.base))
            .send()
            .await?
            .status(),
        200
    );
    let response = app
        .post("/api/v1/servers")
        .json(&json!({"name":"Trusted"}))
        .send()
        .await?;
    assert_eq!(response.status(), 201);
    let server: Value = response.json().await?;
    let job: Value = app
        .post(&format!(
            "/api/v1/servers/{}/stop",
            server["server"]["id"].as_str().ok_or("server ID")?
        ))
        .send()
        .await?
        .json()
        .await?;
    assert!(job["job"]["createdBy"].is_null());
    assert_eq!(app.post("/api/v1/auth/logout").send().await?.status(), 204);
    app.close().await
}

#[tokio::test]
async fn disabled_auth_keeps_browser_origin_protection_and_disables_account_creation() -> Result {
    let app = TestApp::with_auth(false).await?;
    let endpoint = format!("{}/api/v1/servers", app.base);
    assert_eq!(
        app.client
            .post(&endpoint)
            .json(&json!({"name":"Trusted"}))
            .send()
            .await?
            .status(),
        403
    );
    assert_eq!(
        app.client
            .post(&endpoint)
            .header("Origin", "https://untrusted.example")
            .header("X-MCM-CSRF", "1")
            .json(&json!({"name":"Trusted"}))
            .send()
            .await?
            .status(),
        403
    );
    assert_eq!(app.post("/api/v1/setup").json(&json!({"email":"owner@example.com", "password":"correct horse battery staple", "setupToken":"unused"})).send().await?.status(), 409);
    let login = app
        .post("/api/v1/auth/login")
        .json(&json!({"email":"owner@example.com", "password":"correct horse battery staple"}))
        .send()
        .await?;
    assert_eq!(login.status(), 409);
    assert_eq!(login.json::<Value>().await?["code"], "auth.disabled");
    assert!(app.backend.state.auth.setup_required().await?);
    app.close().await
}

#[tokio::test]
async fn setup_validates_email_and_login_normalizes_email_case() -> Result {
    let app = TestApp::new().await?;
    let token = std::fs::read_to_string(app.directory.path().join("setup-token"))?;
    let bad = app.post("/api/v1/setup").json(&json!({"email":"not-an-email", "password":"correct horse battery staple", "setupToken":token})).send().await?;
    assert_eq!(bad.status(), 422);
    let created = app.post("/api/v1/setup").json(&json!({"email":"  Owner@Example.COM  ", "password":"correct horse battery staple", "setupToken":token})).send().await?;
    assert_eq!(created.status(), 201);
    assert_eq!(
        created.json::<Value>().await?["user"]["email"],
        "owner@example.com"
    );
    app.post("/api/v1/auth/logout")
        .send()
        .await?
        .error_for_status()?;
    assert_eq!(
        app.post("/api/v1/auth/login")
            .json(&json!({"email":"OWNER@EXAMPLE.COM", "password":"correct horse battery staple"}))
            .send()
            .await?
            .status(),
        200
    );
    app.close().await
}

#[tokio::test]
async fn enabling_auth_after_a_local_run_requires_setup_and_then_a_session() -> Result {
    let directory = tempfile::tempdir()?;
    let mut config = chunkyard_config::Config {
        data_dir: directory.path().to_owned(),
        ..Default::default()
    };
    config.auth.enabled = false;
    let disabled = chunkyard_server::wiring::build_state(&config).await?;
    assert!(!directory.path().join("setup-token").exists());
    disabled.shutdown().await;
    drop(disabled);
    config.auth.enabled = true;
    let enabled = chunkyard_server::wiring::build_state(&config).await?;
    assert!(enabled.state.auth_enabled);
    assert!(enabled.state.auth.setup_required().await?);
    assert!(directory.path().join("setup-token").is_file());
    enabled.shutdown().await;
    Ok(())
}
