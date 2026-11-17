//! Bounded same-origin live console; no commands are accepted on this socket.
use crate::{AppState, auth, error::ApiError};
use axum::{
    extract::{
        Path, State, WebSocketUpgrade,
        ws::{CloseFrame, Message, WebSocket},
    },
    http::{HeaderMap, StatusCode},
    response::Response,
};
use chunkyard_core::server::ConsoleStream;
use futures_util::{SinkExt, StreamExt};
use serde_json::{Value, json};
use std::{
    sync::{Arc, LazyLock},
    time::Duration,
};
use tokio::sync::Semaphore;

static CONNECTIONS: LazyLock<Arc<Semaphore>> = LazyLock::new(|| Arc::new(Semaphore::new(16)));
#[utoipa::path(get, path = "/api/v1/servers/{id}/console/stream", operation_id = "console_stream_upgrade", tag = "console_stream", params(("id" = String, Path)), responses((status = 101, description = "Success"), (status = "default", description = "Request rejected", body = crate::error::Problem, content_type = "application/problem+json"))) ]
pub(crate) async fn upgrade(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    ws: WebSocketUpgrade,
) -> Result<Response, ApiError> {
    if headers.get("origin").and_then(|s| s.to_str().ok()) != Some(state.origin.as_str()) {
        return Err(ApiError::new(
            StatusCode::FORBIDDEN,
            "http.csrf",
            "A matching Origin is required for console streaming.",
        ));
    }
    let permit = CONNECTIONS.clone().try_acquire_owned().map_err(|_| {
        ApiError::new(
            StatusCode::TOO_MANY_REQUESTS,
            "console.busy",
            "All live console slots are occupied.",
        )
    })?;
    let token = auth::session_cookie(&headers).map(str::to_owned);
    let bearer = auth::bearer(&headers)?.map(str::to_owned);
    let stream = state.servers.console_stream(&id).await?;
    Ok(ws
        .max_message_size(1024)
        .max_frame_size(1024)
        .write_buffer_size(0)
        .max_write_buffer_size(128 * 1024)
        .on_upgrade(move |socket| async move {
            let _permit = permit;
            serve(socket, state, token, bearer, stream).await;
        }))
}
async fn send(
    writer: &mut futures_util::stream::SplitSink<WebSocket, Message>,
    body: Value,
) -> bool {
    matches!(
        tokio::time::timeout(
            Duration::from_secs(10),
            writer.send(Message::Text(body.to_string().into()))
        )
        .await,
        Ok(Ok(()))
    )
}
async fn serve(
    socket: WebSocket,
    state: AppState,
    token: Option<String>,
    bearer: Option<String>,
    mut lines: ConsoleStream,
) {
    let (mut writer, mut reader) = socket.split();
    // The Docker follow request includes its own tail. Reset once, then deliver
    // history and live lines from ONE ordered stream, avoiding a snapshot/follow gap.
    let mut reset_sent = false;
    let mut heartbeat = tokio::time::interval(Duration::from_secs(5));
    heartbeat.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    heartbeat.tick().await;
    let mut last_control = tokio::time::Instant::now();
    loop {
        tokio::select! {
            line=lines.next()=>match line {
                Some(Ok(line))=>{
                    if !reset_sent {
                        if !send(&mut writer,json!({"type":"snapshot","lines":[]})).await {break;}
                        reset_sent=true;
                    }
                    if !send(&mut writer,json!({"type":"line","line":line})).await {break;}
                },
                Some(Err(error))=>{let _=send(&mut writer,json!({"type":"error","code":error.code(),"detail":error.public_detail()})).await;break;},
                None=>{let _=send(&mut writer,json!({"type":"end"})).await;break;},
            },
            incoming=reader.next()=>match incoming {
                Some(Ok(Message::Ping(data)))=>{
                    last_control=tokio::time::Instant::now();
                    if !matches!(tokio::time::timeout(Duration::from_secs(10),writer.send(Message::Pong(data))).await,Ok(Ok(()))) {break;}
                },
                Some(Ok(Message::Pong(_)))=>last_control=tokio::time::Instant::now(),
                _=>break,
            },
            _=heartbeat.tick()=>{
                if last_control.elapsed()>Duration::from_secs(20) {break;}
                if state.auth_enabled || bearer.is_some() {
                    let authenticated=if let Some(key)=&bearer {
                        matches!(tokio::time::timeout(Duration::from_secs(5),state.auth.authenticate_api_key(key,!state.auth_enabled)).await,Ok(Ok(_)))
                    } else {match token.as_deref() {Some(token)=>matches!(tokio::time::timeout(Duration::from_secs(5),state.auth.authenticate(token)).await,Ok(Ok(_))),None=>false}};
                    if !authenticated {
                        let _=send(&mut writer,json!({"type":"error","code":"auth.required","detail":"Sign in to continue."})).await;
                        break;
                    }
                }
                if !matches!(tokio::time::timeout(Duration::from_secs(10),writer.send(Message::Ping(Vec::new().into()))).await,Ok(Ok(()))) {break;}
            }
        }
    }
    let _ = tokio::time::timeout(
        Duration::from_secs(2),
        writer.send(Message::Close(Some(CloseFrame {
            code: 1000,
            reason: "Console stream ended".into(),
        }))),
    )
    .await;
}
