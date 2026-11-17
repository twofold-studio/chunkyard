//! OpenAPI is derived from the same handler registration used by the server.
use crate::error::ApiError;
use axum::Json;
use serde_json::{Value, json};

pub fn generate() -> Result<Value, serde_json::Error> {
    let (_, mut contract) = crate::router::protected_routes().split_for_parts();
    let (_, public) = crate::router::public_routes().split_for_parts();
    let public_paths = public
        .paths
        .paths
        .keys()
        .cloned()
        .collect::<std::collections::BTreeSet<_>>();
    contract.merge(public);
    use utoipa::PartialSchema;
    contract
        .components
        .get_or_insert_with(Default::default)
        .schemas
        .insert(
            "DeletedServer".into(),
            chunkyard_core::server::DeletedServer::schema(),
        );
    let mut doc = serde_json::to_value(contract)?;
    doc["openapi"] = json!("3.1.1");
    doc["info"] = json!({"title":"Chunkyard API","version":env!("CARGO_PKG_VERSION"),
        "description":"Single-owner REST API. Cookie sessions or owner API keys; trusted mode retains Host, Origin and CSRF checks. Binary transfers and WebSocket upgrades use native HTTP. MCP JSON-RPC is a separate protocol at /mcp."});
    doc["servers"] = json!([{"url":"/"}]);
    doc["components"]["securitySchemes"] = json!({
        "cookieAuth":{"type":"apiKey","in":"cookie","name":"mcm_session"},
        "bearerAuth":{"type":"http","scheme":"bearer"}
    });
    doc["security"] = json!([{"cookieAuth":[]},{"bearerAuth":[]}]);
    if let Some(paths) = doc["paths"].as_object_mut() {
        for (path, item) in paths {
            if let Some(methods) = item.as_object_mut() {
                for (method, operation) in methods {
                    if !["get", "post", "put", "patch", "delete"].contains(&method.as_str()) {
                        continue;
                    }
                    if public_paths.contains(path) {
                        operation["security"] = json!([]);
                    }
                    if ["post", "put", "patch", "delete"].contains(&method.as_str()) {
                        if operation.get("parameters").is_none() {
                            operation["parameters"] = json!([]);
                        }
                        if let Some(parameters) = operation["parameters"].as_array_mut() {
                            parameters.push(json!({"name":"X-MCM-CSRF","in":"header","required":true,
                                "description":"Browser mutations require this header and matching Origin. Bearer clients are exempt.",
                                "schema":{"type":"string","enum":["1"]}}));
                        }
                    }
                }
            }
        }
    }
    Ok(doc)
}

#[utoipa::path(get, path = "/api/v1/openapi.json", operation_id = "openapi_document", tag = "contract",
    responses((status = 200, description = "Generated OpenAPI document", content_type = "application/json"),
        (status = "default", description = "Request rejected", body = crate::error::Problem, content_type = "application/problem+json")))]
pub(crate) async fn document() -> Result<Json<Value>, ApiError> {
    Ok(Json(generate().map_err(ApiError::internal)?))
}
