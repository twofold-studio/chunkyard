mod common;
use common::TestApp;
use serde_json::{Value, json};
type Result<T = ()> = std::result::Result<T, Box<dyn std::error::Error>>;

#[tokio::test]
async fn authenticated_java_inventory_discovery_and_release_catalog_match_the_contract() -> Result {
    let app = TestApp::new().await?;
    app.setup().await?;
    let list: Value = app
        .client
        .get(format!("{}/api/v1/java/runtimes", app.base))
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    assert_eq!(list["items"][0]["fullVersion"], "21.0.10");
    let discovery: Value = app
        .post("/api/v1/java/runtimes/discover")
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    assert_eq!(discovery["items"][0]["major"], 21);
    let available: Value = app
        .client
        .get(format!("{}/api/v1/java/available", app.base))
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    assert_eq!(available["mostRecentLts"], 21);
    app.close().await
}

#[tokio::test]
async fn java_install_returns_a_durable_job_and_a_runtime_result() -> Result {
    let app = TestApp::new().await?;
    app.setup().await?;
    let response = app
        .post("/api/v1/java/runtimes/install")
        .json(&json!({"major":21}))
        .send()
        .await?;
    assert_eq!(response.status(), 202);
    let job: Value = response.json().await?;
    let id = job["job"]["id"].as_str().ok_or("missing job ID")?;
    let completed = wait_for_job(&app, id).await?;
    assert_eq!(completed["state"], "succeeded");
    assert_eq!(completed["result"]["runtime"]["major"], 21);
    assert_eq!(completed["progress"], 1.0);
    let list: Value = app
        .client
        .get(format!("{}/api/v1/jobs", app.base))
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    assert_eq!(list["items"][0]["id"], id);
    app.close().await
}

#[tokio::test]
async fn failed_installs_produce_sanitized_pollable_errors() -> Result {
    let app = TestApp::with_options(true, true).await?;
    app.setup().await?;
    let job: Value = app
        .post("/api/v1/java/runtimes/install")
        .json(&json!({"major":21}))
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    let result = wait_for_job(&app, job["job"]["id"].as_str().ok_or("missing ID")?).await?;
    assert_eq!(result["state"], "failed");
    assert_eq!(result["error"]["code"], "download.failed");
    app.close().await
}

#[tokio::test]
async fn disabled_system_discovery_is_enforced_and_invalid_inputs_do_not_start_jobs() -> Result {
    let app = TestApp::with_options(false, false).await?;
    app.setup().await?;
    let inventory: Value = app
        .client
        .get(format!("{}/api/v1/java/runtimes", app.base))
        .send()
        .await?
        .json()
        .await?;
    assert_eq!(inventory["items"], json!([]));
    assert_eq!(
        app.post("/api/v1/java/runtimes/discover")
            .send()
            .await?
            .status(),
        409
    );
    for body in [
        json!({"major":0}),
        json!({"major":21,"path":"untrusted"}),
        json!({"major":"21"}),
    ] {
        assert_eq!(
            app.post("/api/v1/java/runtimes/install")
                .json(&body)
                .send()
                .await?
                .status(),
            422
        );
    }
    assert_eq!(
        app.client
            .get(format!("{}/api/v1/jobs/not-a-uuid", app.base))
            .send()
            .await?
            .status(),
        404
    );
    assert_eq!(
        app.client
            .get(format!("{}/api/v1/jobs?limit=201", app.base))
            .send()
            .await?
            .status(),
        422
    );
    app.close().await
}
async fn wait_for_job(app: &TestApp, id: &str) -> Result<Value> {
    for _ in 0..100 {
        let value: Value = app
            .client
            .get(format!("{}/api/v1/jobs/{id}", app.base))
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;
        if value["state"] == "succeeded" || value["state"] == "failed" {
            return Ok(value);
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    Err("job did not finish".into())
}
