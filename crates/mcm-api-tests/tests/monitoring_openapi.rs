mod common;
use common::TestApp;
use serde_json::{Value, json};
use std::collections::HashSet;
type Result<T = ()> = std::result::Result<T, Box<dyn std::error::Error>>;

#[tokio::test]
async fn schema_is_protected_and_references_only_local_resolvable_schemas() -> Result {
    let app = TestApp::new().await?;
    let url = format!("{}/api/v1/openapi.json", app.base);
    assert_eq!(app.client.get(&url).send().await?.status(), 503);
    app.setup().await?;
    let response = app.client.get(&url).send().await?;
    assert_eq!(response.status(), 200);
    assert_eq!(response.headers()["cache-control"], "no-store");
    let doc: Value = response.json().await?;
    assert_eq!(doc["openapi"], "3.1.1");
    assert_eq!(doc["info"]["title"], "Chunkyard API");
    assert_eq!(doc["info"]["version"], env!("CARGO_PKG_VERSION"));
    check_references(&doc, &doc);
    let paths = doc["paths"].as_object().ok_or("paths missing")?;
    let mut ids = HashSet::new();
    for (path, methods) in paths {
        for (method, operation) in methods.as_object().ok_or("methods missing")? {
            assert!(
                ids.insert(
                    operation["operationId"]
                        .as_str()
                        .ok_or("missing operation ID")?
                )
            );
            let expected_public = [
                "/healthz",
                "/api/v1/setup/status",
                "/api/v1/setup",
                "/api/v1/auth/login",
            ]
            .contains(&path.as_str());
            assert_eq!(
                operation.get("security") == Some(&json!([])),
                expected_public,
                "{path}"
            );
            let concrete = path.replace("{id}", "00000000-0000-0000-0000-000000000000");
            // OPTIONS exercises routing without triggering destructive actions,
            // downloads or local executable probes. Unknown routes return 404.
            let response = app
                .client
                .request(reqwest::Method::OPTIONS, format!("{}{concrete}", app.base))
                .send()
                .await?;
            assert_eq!(
                response.status(),
                405,
                "documented route missing: {method} {path}"
            );
            assert!(operation["responses"].get("default").is_some());
            if method == "post" {
                assert!(
                    operation["parameters"]
                        .as_array()
                        .ok_or("parameters missing")?
                        .iter()
                        .any(|p| p["name"] == "X-MCM-CSRF" && p["required"] == true)
                );
            }
        }
    }
    assert_eq!(
        doc["components"]["securitySchemes"]["cookieAuth"]["name"],
        "mcm_session"
    );
    app.close().await
}
fn check_references(value: &Value, doc: &Value) {
    match value {
        Value::Object(object) => {
            if let Some(reference) = object.get("$ref").and_then(Value::as_str) {
                assert!(reference.starts_with("#/components/schemas/"));
                assert!(
                    doc.pointer(&reference[1..]).is_some(),
                    "dangling reference {reference}"
                );
            }
            for child in object.values() {
                check_references(child, doc);
            }
        }
        Value::Array(array) => {
            for child in array {
                check_references(child, doc);
            }
        }
        _ => (),
    }
}
#[tokio::test]
async fn metrics_are_protected_and_stopped_servers_never_invent_measurements() -> Result {
    let app = TestApp::new().await?;
    let unknown = format!("{}/api/v1/servers/{}/metrics", app.base, uuid::Uuid::nil());
    assert_eq!(app.client.get(&unknown).send().await?.status(), 503);
    app.setup().await?;
    assert_eq!(app.client.get(&unknown).send().await?.status(), 404);
    let created: Value = app
        .post("/api/v1/servers")
        .json(&json!({"name":"Metrics fixture","port":25565}))
        .send()
        .await?
        .json()
        .await?;
    let id = created["server"]["id"].as_str().ok_or("missing ID")?;
    let url = format!("{}/api/v1/servers/{id}/metrics", app.base);
    let metrics: Value = app
        .client
        .get(&url)
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    assert_eq!(metrics["serverId"], id);
    assert_eq!(metrics["status"]["state"], "stopped");
    for field in [
        "cpuPercent",
        "memoryUsageBytes",
        "memoryWorkingSetBytes",
        "uptimeSeconds",
        "networkRxBytes",
    ] {
        assert!(metrics[field].is_null());
    }
    let doc: Value = app
        .client
        .get(format!("{}/api/v1/openapi.json", app.base))
        .send()
        .await?
        .json()
        .await?;
    let properties = doc["components"]["schemas"]["ServerMetrics"]["properties"]
        .as_object()
        .ok_or("schema properties missing")?;
    assert_eq!(
        metrics
            .as_object()
            .ok_or("invalid metrics")?
            .keys()
            .collect::<HashSet<_>>(),
        properties.keys().collect::<HashSet<_>>()
    );
    assert_eq!(
        app.client
            .get(&url)
            .header("Origin", "https://evil.example")
            .send()
            .await?
            .status(),
        403
    );
    app.close().await
}
#[tokio::test]
async fn disabled_auth_exposes_the_same_document_contract_and_checks_host() -> Result {
    let app = TestApp::with_auth(false).await?;
    let url = format!("{}/api/v1/openapi.json", app.base);
    assert_eq!(app.client.get(&url).send().await?.status(), 200);
    assert_eq!(
        app.client
            .get(&url)
            .header("Host", "evil.example")
            .send()
            .await?
            .status(),
        400
    );
    app.close().await
}
