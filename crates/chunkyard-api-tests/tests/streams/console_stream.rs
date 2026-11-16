use crate::common::TestApp;
use futures_util::{SinkExt, StreamExt};
use serde_json::{Value, json};
use tokio_tungstenite::{
    connect_async,
    tungstenite::{Error, Message, client::IntoClientRequest},
};
type Result<T = ()> = std::result::Result<T, Box<dyn std::error::Error>>;
async fn running(app: &TestApp) -> Result<String> {
    let server = app
        .backend
        .state
        .servers
        .create(serde_json::from_value(
            json!({"name":"Socket","acceptEula":true}),
        )?)
        .await?;
    std::fs::write(server.directory.join("server.jar"), "fixture")?;
    app.backend.state.servers.start(&server.server.id).await?;
    Ok(server.server.id)
}
fn request(
    app: &TestApp,
    id: &str,
    origin: Option<&str>,
) -> Result<tokio_tungstenite::tungstenite::http::Request<()>> {
    let url = format!(
        "{}/api/v1/servers/{id}/console/stream",
        app.base.replacen("http://", "ws://", 1)
    );
    let mut request = url.into_client_request()?;
    if let Some(origin) = origin {
        request.headers_mut().insert("Origin", origin.parse()?);
    }
    Ok(request)
}
#[tokio::test]
async fn console_stream_resets_then_delivers_lines_without_polling() -> Result {
    let app = TestApp::with_auth(false).await?;
    let id = running(&app).await?;
    let (mut socket, response) = connect_async(request(&app, &id, Some(&app.base))?).await?;
    assert_eq!(response.status(), 101);
    let first = socket.next().await.ok_or("closed")??;
    let first: Value = serde_json::from_str(first.to_text()?)?;
    assert_eq!(first, json!({"type":"snapshot","lines":[]}));
    let next = socket.next().await.ok_or("closed")??;
    let next: Value = serde_json::from_str(next.to_text()?)?;
    assert_eq!(next["type"], "line");
    assert!(
        next["line"]["text"]
            .as_str()
            .is_some_and(|s| s.contains("Done"))
    );
    socket.send(Message::Close(None)).await?;
    app.close().await
}
#[tokio::test]
async fn sockets_require_same_origin_even_when_auth_is_disabled() -> Result {
    let app = TestApp::with_auth(false).await?;
    let id = running(&app).await?;
    for origin in [None, Some("https://evil.example")] {
        let result = connect_async(request(&app, &id, origin)?).await;
        assert!(matches!(result,Err(Error::Http(response)) if response.status()==403));
    }
    app.close().await
}
#[tokio::test]
async fn socket_session_is_rechecked_after_logout() -> Result {
    let app = TestApp::new().await?;
    let setup = app.setup().await?;
    let _ = setup;
    let id = running(&app).await?;
    let mut req = request(&app, &id, Some(&app.base))?;
    // Login again to capture just this test session's response cookie.
    let login = app
        .post("/api/v1/auth/login")
        .json(&json!({"email":"owner@example.com","password":"correct horse battery staple"}))
        .send()
        .await?
        .error_for_status()?;
    let cookie = login
        .headers()
        .get("set-cookie")
        .ok_or("cookie")?
        .to_str()?
        .split(';')
        .next()
        .ok_or("cookie")?
        .to_owned();
    req.headers_mut().insert("Cookie", cookie.parse()?);
    let (mut socket, _) = connect_async(req).await?;
    assert_eq!(app.post("/api/v1/auth/logout").send().await?.status(), 204);
    let revoked = tokio::time::timeout(std::time::Duration::from_secs(9), async {
        while let Some(message) = socket.next().await {
            let message = message?;
            if let Message::Text(text) = message {
                let event: Value = serde_json::from_str(text.as_str())?;
                if event["code"] == "auth.required" {
                    return Ok::<_, Box<dyn std::error::Error>>(());
                }
            }
        }
        Err("socket ended without session error".into())
    })
    .await?;
    revoked?;
    let _ = socket.close(None).await;
    app.close().await
}
