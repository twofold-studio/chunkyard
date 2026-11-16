use crate::common::TestApp;
use serde_json::{Value, json};
pub(super) type Result<T = ()> = std::result::Result<T, Box<dyn std::error::Error>>;

pub(super) async fn create(app: &TestApp) -> Result<(String, std::path::PathBuf)> {
    let created: Value = app
        .post("/api/v1/servers")
        .json(&json!({"name":"Files","acceptEula":true}))
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    Ok((
        created["server"]["id"].as_str().ok_or("id")?.into(),
        created["server"]["directory"]
            .as_str()
            .ok_or("directory")?
            .into(),
    ))
}
pub(super) fn put(app: &TestApp, route: &str) -> reqwest::RequestBuilder {
    app.client
        .put(format!("{}{route}", app.base))
        .header("Origin", &app.base)
        .header("X-MCM-CSRF", "1")
}
