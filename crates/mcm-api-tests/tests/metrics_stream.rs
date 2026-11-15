mod common;
use common::TestApp;
use futures_util::{SinkExt, StreamExt};
use serde_json::{Value, json};
use tokio_tungstenite::{
    connect_async,
    tungstenite::{Error, Message, client::IntoClientRequest},
};
type Result<T = ()> = std::result::Result<T, Box<dyn std::error::Error>>;
#[tokio::test]
async fn first_fresh_sample_does_not_wait_for_a_slow_delivery_timer() -> Result {
    let app = TestApp::with_auth(false).await?;
    let server = app
        .backend
        .state
        .servers
        .create(serde_json::from_value(
            json!({"name":"slow metrics","acceptEula":true}),
        )?)
        .await?;
    std::fs::write(server.directory.join("server.jar"), "fixture")?;
    app.backend.state.servers.start(&server.server.id).await?;
    let (mut socket, _) = connect_async(request(&app, &server.server.id, 5000, true)?).await?;
    let frame = tokio::time::timeout(std::time::Duration::from_millis(800), socket.next())
        .await?
        .ok_or("closed")??;
    let frame: Value = serde_json::from_str(frame.to_text()?)?;
    assert_eq!(frame["type"], "sample");
    socket.send(Message::Close(None)).await?;
    app.close().await
}
fn request(
    app: &TestApp,
    id: &str,
    interval: u32,
    origin: bool,
) -> Result<tokio_tungstenite::tungstenite::http::Request<()>> {
    let mut request = format!(
        "{}/api/v1/servers/{id}/metrics/stream?intervalMs={interval}",
        app.base.replace("http://", "ws://")
    )
    .into_client_request()?;
    if origin {
        request.headers_mut().insert("Origin", app.base.parse()?);
    }
    Ok(request)
}
#[tokio::test]
async fn multiple_viewers_share_one_native_feed_and_only_fresh_samples() -> Result {
    let app = TestApp::with_auth(false).await?;
    let server = app
        .backend
        .state
        .servers
        .create(serde_json::from_value(
            json!({"name":"metrics","acceptEula":true}),
        )?)
        .await?;
    std::fs::write(server.directory.join("server.jar"), "fixture")?;
    app.backend.state.servers.start(&server.server.id).await?;
    let id = &server.server.id;
    let (mut first, _) = connect_async(request(&app, id, 100, true)?).await?;
    let (mut second, _) = connect_async(request(&app, id, 250, true)?).await?;
    for socket in [&mut first, &mut second] {
        let frame = tokio::time::timeout(std::time::Duration::from_secs(3), socket.next())
            .await?
            .ok_or("closed")??;
        let frame: Value = serde_json::from_str(frame.to_text()?)?;
        assert_eq!(frame["type"], "sample");
        assert_eq!(frame["sample"]["serverId"], *id);
    }
    assert_eq!(
        app.runtime
            .metrics_streams
            .load(std::sync::atomic::Ordering::SeqCst),
        1
    );
    let mut last = String::new();
    for _ in 0..3 {
        let frame = tokio::time::timeout(std::time::Duration::from_secs(3), first.next())
            .await?
            .ok_or("closed")??;
        let frame: Value = serde_json::from_str(frame.to_text()?)?;
        let timestamp = frame["sample"]["sampledAt"].as_str().ok_or("timestamp")?;
        assert_ne!(timestamp, last);
        last = timestamp.into();
    }
    first.send(Message::Close(None)).await?;
    tokio::time::timeout(std::time::Duration::from_secs(3), async {
        loop {
            let interval = app
                .runtime
                .metrics_sampling
                .lock()
                .ok()
                .and_then(|sampling| sampling.as_ref().map(|sampling| sampling.interval_ms()));
            if interval == Some(250) {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
    })
    .await?;
    second.send(Message::Close(None)).await?;
    tokio::time::timeout(std::time::Duration::from_secs(3), async {
        while app
            .runtime
            .active_metrics_streams
            .load(std::sync::atomic::Ordering::SeqCst)
            > 0
        {
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
    })
    .await?;
    app.close().await
}
#[tokio::test]
async fn metrics_sockets_validate_origin_interval_and_local_running_state() -> Result {
    let app = TestApp::with_auth(false).await?;
    let server = app
        .backend
        .state
        .servers
        .create(serde_json::from_value(json!({"name":"stopped"}))?)
        .await?;
    for (interval, origin, status) in [
        (100, false, 403),
        (99, true, 422),
        (60001, true, 422),
        (100, true, 409),
    ] {
        let result = connect_async(request(&app, &server.server.id, interval, origin)?).await;
        assert!(matches!(result,Err(Error::Http(response)) if response.status().as_u16()==status));
    }
    app.close().await
}
