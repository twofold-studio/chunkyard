mod common;
use common::TestApp;
use serde_json::{Value, json};
type Result<T = ()> = std::result::Result<T, Box<dyn std::error::Error>>;

#[tokio::test]
async fn token_verification_does_not_create_an_account_session_or_consume_the_token() -> Result {
    let app = TestApp::new().await?;
    let path = app.directory.path().join("setup-token");
    let token = std::fs::read_to_string(&path)?;
    let url = "/api/v1/setup/verify-token";
    let wrong = app
        .post(url)
        .json(&json!({"setupToken":"wrong"}))
        .send()
        .await?;
    assert_eq!(wrong.status(), 401);
    assert_eq!(wrong.json::<Value>().await?["code"], "setup.invalid_token");
    for _ in 0..2 {
        let response = app
            .post(url)
            .json(&json!({"setupToken":token}))
            .send()
            .await?;
        assert_eq!(response.status(), 204);
        assert!(!response.headers().contains_key("set-cookie"));
        assert!(response.bytes().await?.is_empty());
    }
    assert_eq!(std::fs::read_to_string(&path)?, token);
    assert!(app.backend.state.auth.setup_required().await?);
    assert_eq!(
        app.client
            .get(format!("{}/api/v1/auth/me", app.base))
            .send()
            .await?
            .status(),
        503
    );
    // Verification is not a durable grant: creation must validate the token again.
    let response = app.post("/api/v1/setup").json(&json!({"setupToken":"wrong","email":"owner@example.com","password":"correct horse battery staple"})).send().await?;
    assert_eq!(response.status(), 401);
    app.setup().await?;
    assert!(!path.exists());
    let after = app
        .post(url)
        .json(&json!({"setupToken":token}))
        .send()
        .await?;
    assert_eq!(after.status(), 409);
    assert_eq!(after.json::<Value>().await?["code"], "setup.already_done");
    app.close().await
}
#[tokio::test]
async fn verification_keeps_browser_checks_and_is_disabled_with_auth() -> Result {
    let app = TestApp::new().await?;
    let path = "/api/v1/setup/verify-token";
    assert_eq!(
        app.client
            .post(format!("{}{path}", app.base))
            .json(&json!({"setupToken":"wrong"}))
            .send()
            .await?
            .status(),
        403
    );
    assert_eq!(
        app.client
            .post(format!("{}{path}", app.base))
            .header("X-MCM-CSRF", "1")
            .header("Origin", "https://evil.example")
            .json(&json!({"setupToken":"wrong"}))
            .send()
            .await?
            .status(),
        403
    );
    assert_eq!(
        app.post(path)
            .json(&json!({"setupToken":"wrong","email":"unexpected"}))
            .send()
            .await?
            .status(),
        422
    );
    app.close().await?;
    let app = TestApp::with_auth(false).await?;
    let response = app
        .post(path)
        .json(&json!({"setupToken":"wrong"}))
        .send()
        .await?;
    assert_eq!(response.status(), 409);
    assert_eq!(response.json::<Value>().await?["code"], "auth.disabled");
    assert!(!app.directory.path().join("setup-token").exists());
    app.close().await
}
