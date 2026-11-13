mod common;
use common::TestApp;
use serde_json::{Value, json};
type Result<T = ()> = std::result::Result<T, Box<dyn std::error::Error>>;

#[tokio::test]
async fn setup_login_logout_and_session_revocation_work_over_http() -> Result {
    let app = TestApp::new().await?;
    let response = app
        .client
        .get(format!("{}/api/v1/java/runtimes", app.base))
        .send()
        .await?;
    assert_eq!(response.status(), 503);
    let owner = app.setup().await?;
    assert_eq!(owner["user"]["role"], "owner");
    assert!(!app.directory.path().join("setup-token").exists());
    let me: Value = app
        .client
        .get(format!("{}/api/v1/auth/me", app.base))
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    assert_eq!(me["user"]["email"], "owner@example.com");
    assert_eq!(app.post("/api/v1/auth/logout").send().await?.status(), 204);
    assert_eq!(
        app.client
            .get(format!("{}/api/v1/auth/me", app.base))
            .send()
            .await?
            .status(),
        401
    );
    let login = app
        .post("/api/v1/auth/login")
        .json(&json!({"email":"owner@example.com", "password":"correct horse battery staple"}))
        .send()
        .await?;
    assert_eq!(login.status(), 200);
    let cookie = login
        .headers()
        .get("set-cookie")
        .ok_or("cookie missing")?
        .to_str()?;
    assert!(cookie.contains("HttpOnly") && cookie.contains("SameSite=Lax"));
    let replay = app.post("/api/v1/setup").json(&json!({"setupToken":"ignored", "email":"another", "password":"correct horse battery staple"})).send().await?;
    assert_eq!(replay.status(), 409);
    app.close().await
}

#[tokio::test]
async fn origin_custom_header_and_host_checks_block_cross_site_requests() -> Result {
    let app = TestApp::new().await?;
    let body = json!({"email":"owner@example.com", "password":"test password"});
    let endpoint = format!("{}/api/v1/auth/login", app.base);
    assert_eq!(
        app.client
            .post(&endpoint)
            .json(&body)
            .send()
            .await?
            .status(),
        403
    );
    assert_eq!(
        app.client
            .post(&endpoint)
            .header("Origin", "https://evil.example")
            .header("X-MCM-CSRF", "1")
            .json(&body)
            .send()
            .await?
            .status(),
        403
    );
    assert_eq!(
        app.client
            .get(format!("{}/healthz", app.base))
            .header("Host", "evil.example")
            .send()
            .await?
            .status(),
        400
    );
    let valid = app
        .client
        .get(format!("{}/healthz", app.base))
        .send()
        .await?;
    assert_eq!(valid.status(), 200);
    assert_eq!(valid.headers()["cache-control"], "no-store");
    assert_eq!(valid.headers()["x-content-type-options"], "nosniff");
    assert!(valid.headers().contains_key("x-request-id"));
    app.close().await
}

#[tokio::test]
async fn unknown_users_and_wrong_passwords_have_the_same_public_error() -> Result {
    let app = TestApp::new().await?;
    app.setup().await?;
    for username in ["owner@example.com", "missing@example.com"] {
        let response = app
            .post("/api/v1/auth/login")
            .json(&json!({"email":username, "password":"the wrong password"}))
            .send()
            .await?;
        assert_eq!(response.status(), 401);
        assert_eq!(
            response.headers()["content-type"],
            "application/problem+json"
        );
        let body: Value = response.json().await?;
        assert_eq!(body["code"], "auth.invalid_credentials");
        assert!(!body.to_string().contains("password_hash"));
    }
    app.close().await
}

#[tokio::test]
async fn missing_setup_token_and_invalid_json_are_safe_errors() -> Result {
    let app = TestApp::new().await?;
    let invalid = app.post("/api/v1/setup").json(&json!({"setupToken":"wrong", "email":"owner@example.com", "password":"correct horse battery staple"})).send().await?;
    assert_eq!(invalid.status(), 401);
    assert!(app.directory.path().join("setup-token").exists());
    let response = app
        .post("/api/v1/setup")
        .header("Content-Type", "application/json")
        .body("{broken")
        .send()
        .await?;
    assert_eq!(response.status(), 400);
    assert_eq!(
        response.headers()["content-type"],
        "application/problem+json"
    );
    app.close().await
}

#[tokio::test]
async fn a_revoked_cookie_cannot_be_replayed_and_duplicate_cookies_are_rejected() -> Result {
    let app = TestApp::new().await?;
    app.setup().await?;
    let issued = app
        .backend
        .state
        .auth
        .login(
            "owner@example.com",
            "correct horse battery staple".into(),
            "127.0.0.1".parse()?,
        )
        .await?;
    let headers = format!("mcm_session={}", issued.token);
    let client = reqwest::Client::builder().no_proxy().build()?;
    let endpoint = format!("{}/api/v1/auth/me", app.base);
    assert_eq!(
        client
            .get(&endpoint)
            .header("Cookie", &headers)
            .send()
            .await?
            .status(),
        200
    );
    assert_eq!(
        client
            .get(&endpoint)
            .header("Cookie", format!("{headers}; {headers}"))
            .send()
            .await?
            .status(),
        401
    );
    app.backend.state.auth.logout(&issued.token).await?;
    assert_eq!(
        client
            .get(&endpoint)
            .header("Cookie", &headers)
            .send()
            .await?
            .status(),
        401
    );
    app.close().await
}

#[tokio::test]
async fn expired_and_unknown_sessions_do_not_pass_authentication_and_raw_tokens_are_not_stored()
-> Result {
    use mcm_core::auth::AuthRepo;
    let app = TestApp::new().await?;
    app.setup().await?;
    let issued = app
        .backend
        .state
        .auth
        .login(
            "owner@example.com",
            "correct horse battery staple".into(),
            "127.0.0.1".parse()?,
        )
        .await?;
    let repo = mcm_db::SqliteAuthRepo::new(&app.backend.database);
    let now = mcm_auth::unix_time();
    assert!(repo.session(&issued.token, now).await?.is_none());
    assert!(
        repo.session(&mcm_auth::token_hash(&issued.token), now)
            .await?
            .is_some()
    );
    assert!(
        repo.session(&mcm_auth::token_hash(&issued.token), now + 30 * 86400)
            .await?
            .is_none()
    );
    app.close().await
}

#[tokio::test]
async fn body_limits_and_database_health_are_reported_without_internal_details() -> Result {
    let app = TestApp::new().await?;
    let response = app
        .post("/api/v1/setup")
        .header("Content-Type", "application/json")
        .body("x".repeat(1024 * 1024 + 1))
        .send()
        .await?;
    assert_eq!(response.status(), 413);
    assert_eq!(
        response.headers()["content-type"],
        "application/problem+json"
    );
    app.backend.database.close().await;
    let health = app
        .client
        .get(format!("{}/healthz", app.base))
        .send()
        .await?;
    assert_eq!(health.status(), 503);
    assert_eq!(health.json::<Value>().await?["status"], "db_unavailable");
    app.close().await
}
