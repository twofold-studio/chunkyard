use crate::common::TestApp;
use serde_json::{Value, json};
use std::collections::HashSet;
type Result<T = ()> = std::result::Result<T, Box<dyn std::error::Error>>;

#[test]
fn offline_contract_is_deterministic_and_matches_the_checked_in_artifact() -> Result {
    let generated = chunkyard_api::openapi::generate()?;
    assert_eq!(generated, chunkyard_api::openapi::generate()?);
    let checked_in: Value = serde_json::from_str(include_str!("../../../api/src/openapi.json"))?;
    assert_eq!(generated, checked_in);
    // The intentionally dynamic JSON fields remain honest, rather than invented DTOs.
    assert_eq!(
        generated["components"]["schemas"]["Job"]["properties"]["result"],
        json!({})
    );
    assert_eq!(
        generated["components"]["schemas"]["BinaryBody"]["format"],
        "binary"
    );
    Ok(())
}

fn validate_response(doc: &Value, path: &str, method: &str, status: u16, body: &Value) -> Result {
    let responses = &doc["paths"][path][method]["responses"];
    let response = responses
        .get(status.to_string())
        .unwrap_or(&responses["default"]);
    let media = response["content"]
        .as_object()
        .ok_or("missing response content")?;
    let schema = &media.values().next().ok_or("missing media type")?["schema"];
    let mut root = schema.clone();
    root["components"] = doc["components"].clone();
    let validator = jsonschema::validator_for(&root)?;
    let errors = validator
        .iter_errors(body)
        .map(|e| e.to_string())
        .collect::<Vec<_>>();
    assert!(errors.is_empty(), "{method} {path} ({status}): {errors:?}");
    Ok(())
}

#[tokio::test]
async fn actual_rest_successes_and_errors_match_the_generated_schemas() -> Result {
    let app = TestApp::new().await?;
    let doc = chunkyard_api::openapi::generate()?;
    app.setup().await?;
    let response = app
        .post("/api/v1/servers")
        .json(&json!({"name":"Schema fixture"}))
        .send()
        .await?;
    assert_eq!(response.status(), 201);
    let body: Value = response.json().await?;
    validate_response(&doc, "/api/v1/servers", "post", 201, &body)?;
    let id = body["server"]["id"].as_str().ok_or("missing server ID")?;
    let response = app
        .client
        .put(format!("{}/api/v1/servers/{id}/recovery", app.base))
        .header("Origin", &app.base)
        .header("X-MCM-CSRF", "1")
        .json(&json!({}))
        .send()
        .await?;
    assert_eq!(response.status(), 200);
    let policy: Value = response.json().await?;
    assert_eq!(policy["recovery"]["maxAttempts"], 3);
    validate_response(&doc, "/api/v1/servers/{id}/recovery", "put", 200, &policy)?;
    for path in [
        "/api/v1/servers",
        "/api/v1/auth/me",
        "/api/v1/setup/status",
        "/api/v1/system/version",
        "/api/v1/software",
        "/api/v1/jobs",
        "/api/v1/storage",
        "/api/v1/exports",
        "/api/v1/servers/{id}",
        "/api/v1/servers/{id}/network",
        "/api/v1/servers/{id}/metrics",
        "/api/v1/servers/{id}/automation",
        "/api/v1/servers/{id}/players",
        "/api/v1/servers/{id}/metrics/history",
    ] {
        let response = app
            .client
            .get(format!("{}{}", app.base, path.replace("{id}", id)))
            .send()
            .await?;
        let status = response.status().as_u16();
        assert_eq!(status, 200, "{path}");
        validate_response(&doc, path, "get", status, &response.json::<Value>().await?)?;
    }
    let response = app
        .client
        .get(format!("{}/api/v1/jobs/invalid", app.base))
        .send()
        .await?;
    assert_eq!(response.status(), 404);
    validate_response(
        &doc,
        "/api/v1/jobs/{id}",
        "get",
        404,
        &response.json::<Value>().await?,
    )?;
    app.close().await
}

#[tokio::test]
async fn engine_capacity_requires_setup_and_reports_totals_in_bytes() -> Result {
    let app = TestApp::new().await?;
    let url = format!("{}/api/v1/system/isolation", app.base);
    assert_eq!(app.client.get(&url).send().await?.status(), 503);
    app.setup().await?;
    let response = app.client.get(&url).send().await?;
    assert_eq!(response.status(), 200);
    assert_eq!(response.headers()["cache-control"], "no-store");
    let body: Value = response.json().await?;
    assert_eq!(body["docker"]["capacity"]["logicalCpus"], 4);
    assert_eq!(
        body["docker"]["capacity"]["memoryTotalBytes"],
        24_u64 * 1024 * 1024 * 1024
    );
    assert_eq!(body["docker"]["capacity"]["architecture"], "aarch64");
    Ok(())
}

#[tokio::test]
async fn schema_is_public_and_references_only_local_resolvable_components() -> Result {
    let app = TestApp::new().await?;
    let url = format!("{}/api/v1/openapi.json", app.base);
    assert_eq!(app.client.get(&url).send().await?.status(), 200);
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
            if !["get", "post", "put", "patch", "delete", "head", "options"]
                .contains(&method.as_str())
            {
                continue;
            }
            assert!(
                ids.insert(
                    operation["operationId"]
                        .as_str()
                        .ok_or("missing operation ID")?
                )
            );
            let expected_public = [
                "/healthz",
                "/api/v1/openapi.json",
                "/api/v1/system/version",
                "/api/v1/system/changelog",
                "/api/v1/setup/status",
                "/api/v1/setup",
                "/api/v1/setup/verify-token",
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
            if path != "/mcp" && ["post", "put", "patch", "delete"].contains(&method.as_str()) {
                assert!(
                    operation["parameters"]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .chain(methods["parameters"].as_array().into_iter().flatten())
                        .map(|p| p
                            .get("$ref")
                            .and_then(Value::as_str)
                            .and_then(|reference| doc.pointer(&reference[1..]))
                            .unwrap_or(p))
                        .any(|p| p["name"] == "X-MCM-CSRF")
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
                assert!(
                    [
                        "#/components/schemas/",
                        "#/components/parameters/",
                        "#/components/responses/"
                    ]
                    .iter()
                    .any(|prefix| reference.starts_with(prefix)),
                    "external or unsupported reference {reference}"
                );
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
