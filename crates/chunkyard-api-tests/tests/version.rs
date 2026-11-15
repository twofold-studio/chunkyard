mod common;
use common::TestApp;
use serde_json::Value;
type Result<T = ()> = std::result::Result<T, Box<dyn std::error::Error>>;

#[tokio::test]
async fn version_and_changelog_are_available_during_first_run_without_creating_an_owner() -> Result
{
    let app = TestApp::new().await?;
    let response = app
        .client
        .get(format!("{}/api/v1/system/version", app.base))
        .send()
        .await?;
    assert_eq!(response.status(), 200);
    assert_eq!(response.headers()["cache-control"], "no-store");
    let body: Value = response.json().await?;
    assert_eq!(body["enabled"], true);
    assert_eq!(body["version"], env!("CARGO_PKG_VERSION"));
    assert_eq!(body["channel"], "development");
    let response = app
        .client
        .get(format!("{}/api/v1/system/changelog", app.base))
        .send()
        .await?;
    assert_eq!(response.status(), 200);
    let body: Value = response.json().await?;
    assert_eq!(body["markdown"], include_str!("../../../CHANGELOG.md"));
    assert!(app.backend.state.auth.setup_required().await?);
    assert_eq!(
        app.client
            .get(format!("{}/api/v1/system/version", app.base))
            .header("Origin", "https://evil.example")
            .send()
            .await?
            .status(),
        403
    );
    app.close().await
}
#[tokio::test]
async fn disabled_setting_omits_the_version_and_does_not_expose_the_changelog() -> Result {
    let app = TestApp::with_version(false).await?;
    let body: Value = app
        .client
        .get(format!("{}/api/v1/system/version", app.base))
        .send()
        .await?
        .json()
        .await?;
    assert_eq!(body["enabled"], false);
    assert!(body["version"].is_null());
    assert!(body["channel"].is_null());
    let response = app
        .client
        .get(format!("{}/api/v1/system/changelog", app.base))
        .send()
        .await?;
    assert_eq!(response.status(), 404);
    assert_eq!(response.json::<Value>().await?["code"], "version.disabled");
    assert_eq!(
        app.client
            .get(format!("{}/api/v1/system/version", app.base))
            .header("Host", "evil.example")
            .send()
            .await?
            .status(),
        400
    );
    app.close().await
}
