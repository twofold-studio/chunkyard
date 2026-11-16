use crate::common::TestApp;
use serde_json::{Value, json};
type Result<T = ()> = std::result::Result<T, Box<dyn std::error::Error>>;

#[tokio::test]
async fn keys_are_one_time_hashed_revocable_and_cannot_mint_keys() -> Result {
    let app = TestApp::new().await?;
    assert_eq!(
        app.client
            .get(format!("{}/api/v1/openapi.json", app.base))
            .send()
            .await?
            .status(),
        200
    );
    app.setup().await?;
    let response = app
        .post("/api/v1/auth/api-keys")
        .json(&json!({"name":"Claude"}))
        .send()
        .await?;
    assert_eq!(response.status(), 201);
    assert_eq!(response.headers()["cache-control"], "no-store");
    let issued: Value = response.json().await?;
    let token = issued["token"].as_str().ok_or("token missing")?;
    assert_eq!(token.len(), 47);
    let list = app
        .client
        .get(format!("{}/api/v1/auth/api-keys", app.base))
        .send()
        .await?
        .json::<Value>()
        .await?;
    assert_eq!(list["items"][0]["name"], "Claude");
    assert!(!list.to_string().contains(token));
    assert!(list["items"][0].get("token_hash").is_none());
    let connection = sqlx::SqlitePool::connect(&format!(
        "sqlite://{}",
        app.directory.path().join("mcm.db").display()
    ))
    .await?;
    let hash: String = sqlx::query_scalar("SELECT token_hash FROM api_keys")
        .fetch_one(&connection)
        .await?;
    assert_eq!(hash, chunkyard_auth::token_hash(token));
    assert_ne!(hash, token);
    let client = reqwest::Client::builder().no_proxy().build()?;
    assert_eq!(
        client
            .get(format!("{}/api/v1/servers", app.base))
            .bearer_auth(token)
            .send()
            .await?
            .status(),
        200
    );
    assert_eq!(
        client
            .post(format!("{}/api/v1/servers", app.base))
            .bearer_auth(token)
            .json(&json!({"name":"From API"}))
            .send()
            .await?
            .status(),
        201
    );
    assert_eq!(
        client
            .post(format!("{}/api/v1/auth/api-keys", app.base))
            .bearer_auth(token)
            .json(&json!({"name":"Forbidden"}))
            .send()
            .await?
            .status(),
        403
    );
    assert_eq!(
        client
            .get(format!("{}/api/v1/servers", app.base))
            .bearer_auth(token)
            .header("Origin", "https://evil.example")
            .send()
            .await?
            .status(),
        403
    );
    assert_eq!(
        app.client
            .get(format!("{}/api/v1/servers", app.base))
            .bearer_auth(token)
            .send()
            .await?
            .status(),
        401
    );
    assert_eq!(
        app.client
            .delete(format!(
                "{}/api/v1/auth/api-keys/{}",
                app.base,
                issued["key"]["id"].as_str().ok_or("id")?
            ))
            .header("Origin", &app.base)
            .header("X-MCM-CSRF", "1")
            .send()
            .await?
            .status(),
        204
    );
    assert_eq!(
        client
            .get(format!("{}/api/v1/servers", app.base))
            .bearer_auth(token)
            .send()
            .await?
            .status(),
        401
    );
    connection.close().await;
    app.close().await
}

#[tokio::test]
async fn mcp_protocol_tools_and_validation_use_bearer_auth_and_real_services() -> Result {
    let app = TestApp::with_auth(false).await?;
    let (_, token) = app.backend.state.auth.issue_api_key("MCP", None).await?;
    let client = reqwest::Client::new();
    let request = |body: Value| {
        client
            .post(format!("{}/mcp", app.base))
            .bearer_auth(&token)
            .header("Accept", "application/json, text/event-stream")
            .json(&body)
    };
    let init=request(json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"test","version":"1"}}})).send().await?;
    assert_eq!(init.status(), 200);
    let init: Value = init.json().await?;
    assert_eq!(init["result"]["protocolVersion"], "2025-11-25");
    assert_eq!(init["result"]["serverInfo"]["name"], "chunkyard");
    assert_eq!(
        request(json!({"jsonrpc":"2.0","method":"notifications/initialized"}))
            .send()
            .await?
            .status(),
        202
    );
    let tools = request(json!({"jsonrpc":"2.0","id":2,"method":"tools/list"}))
        .send()
        .await?
        .json::<Value>()
        .await?;
    assert!(
        tools["result"]["tools"]
            .as_array()
            .ok_or("tools")?
            .iter()
            .any(|t| t["name"] == "list_servers")
    );
    let list=request(json!({"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"list_servers","arguments":{}}})).send().await?.json::<Value>().await?;
    assert_eq!(list["result"]["structuredContent"]["items"], json!([]));
    assert_eq!(list["result"]["isError"], false);
    let invalid=request(json!({"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"stop_server","arguments":{"serverId":"bad"}}})).send().await?.json::<Value>().await?;
    assert_eq!(invalid["result"]["isError"], true);
    assert!(
        invalid["result"]["content"][0]["text"]
            .as_str()
            .ok_or("text")?
            .contains("confirm")
    );
    let unknown=request(json!({"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"delete_all","arguments":{}}})).send().await?.json::<Value>().await?;
    assert_eq!(unknown["error"]["code"], -32602);
    assert_eq!(
        client
            .post(format!("{}/mcp", app.base))
            .header("Origin", &app.base)
            .header("X-MCM-CSRF", "1")
            .json(&json!({}))
            .send()
            .await?
            .status(),
        401
    );
    assert_eq!(
        request(json!({}))
            .header("Origin", "https://evil.example")
            .send()
            .await?
            .status(),
        403
    );
    assert_eq!(
        request(json!({}))
            .header("MCP-Protocol-Version", "bad")
            .send()
            .await?
            .status(),
        400
    );
    assert_eq!(
        client
            .get(format!("{}/mcp", app.base))
            .bearer_auth(&token)
            .send()
            .await?
            .status(),
        405
    );
    app.close().await
}

#[tokio::test]
async fn invalid_bearer_never_falls_back_and_browser_mutations_still_need_csrf() -> Result {
    let app = TestApp::with_auth(false).await?;
    assert_eq!(
        app.client
            .get(format!("{}/api/v1/servers", app.base))
            .bearer_auth("bad")
            .send()
            .await?
            .status(),
        401
    );
    assert_eq!(
        app.client
            .post(format!("{}/api/v1/auth/api-keys", app.base))
            .json(&json!({"name":"bad"}))
            .send()
            .await?
            .status(),
        403
    );
    for name in ["", "bad\nname"] {
        assert_eq!(
            app.post("/api/v1/auth/api-keys")
                .json(&json!({"name":name}))
                .send()
                .await?
                .status(),
            422
        );
    }
    let (_, token) = app
        .backend
        .state
        .auth
        .issue_api_key("trusted", None)
        .await?;
    assert!(
        app.backend
            .state
            .auth
            .authenticate_api_key(&token, true)
            .await
            .is_ok()
    );
    assert!(
        app.backend
            .state
            .auth
            .authenticate_api_key(&token, false)
            .await
            .is_err()
    );
    app.close().await
}

#[tokio::test]
async fn key_capacity_is_bounded_and_revocation_frees_a_slot() -> Result {
    let app = TestApp::with_auth(false).await?;
    let mut first = String::new();
    for index in 0..100 {
        let (key, _) = app
            .backend
            .state
            .auth
            .issue_api_key(&format!("key {index}"), None)
            .await?;
        if index == 0 {
            first = key.id;
        }
    }
    assert!(matches!(
        app.backend.state.auth.issue_api_key("overflow", None).await,
        Err(chunkyard_auth::AuthError::KeyLimit)
    ));
    app.backend.state.auth.revoke_api_key(&first).await?;
    assert!(
        app.backend
            .state
            .auth
            .issue_api_key("replacement", None)
            .await
            .is_ok()
    );
    app.close().await
}
