use crate::common::TestApp;
use serde_json::{Value, json};
type Result<T = ()> = std::result::Result<T, Box<dyn std::error::Error>>;

#[tokio::test]
async fn stopped_network_settings_persist_and_can_restore_the_default() -> Result {
    let app = TestApp::with_auth(false).await?;
    let created: Value = app
        .post("/api/v1/servers")
        .json(&json!({"name":"Network"}))
        .send()
        .await?
        .json()
        .await?;
    let id = created["server"]["id"].as_str().ok_or("id")?;
    let path = format!("{}/api/v1/servers/{id}/network", app.base);
    let initial: Value = app.client.get(&path).send().await?.json().await?;
    assert_eq!(initial["effectivePublishIp"], "0.0.0.0");
    for ip in [Some("127.0.0.1"), None] {
        let response = app
            .client
            .patch(&path)
            .header("Origin", &app.base)
            .header("X-MCM-CSRF", "1")
            .json(&json!({"port":25567,"publishIp":ip}))
            .send()
            .await?;
        assert_eq!(response.status(), 200);
        let settings: Value = app.client.get(&path).send().await?.json().await?;
        assert_eq!(settings["port"], 25567);
        assert_eq!(settings["publishIp"], json!(ip));
        assert_eq!(settings["effectivePublishIp"], ip.unwrap_or("0.0.0.0"));
    }
    assert_eq!(
        app.client
            .patch(&path)
            .json(&json!({"port":25565,"publishIp":null}))
            .send()
            .await?
            .status(),
        403
    );
    for body in [
        json!({"port":0,"publishIp":null}),
        json!({"port":25565,"publishIp":"not-an-ip"}),
    ] {
        assert_eq!(
            app.client
                .patch(&path)
                .header("Origin", &app.base)
                .header("X-MCM-CSRF", "1")
                .json(&body)
                .send()
                .await?
                .status(),
            422
        );
    }
    app.close().await
}
