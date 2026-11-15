//! Shared Docker metrics, latest-value backpressure and bounded socket delivery.
use crate::{AppState, auth, error::ApiError};
use axum::{
    extract::{
        Path, Query, State, WebSocketUpgrade,
        ws::{Message, WebSocket},
    },
    http::{HeaderMap, StatusCode},
    response::Response,
};
use futures_util::{SinkExt, StreamExt};
use mcm_core::server::{MetricsSampling, ServerError, ServerService};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    sync::{Arc, Weak},
    time::Duration,
};
use tokio::sync::{Mutex, Semaphore, watch};

pub struct MetricsHub {
    feeds: Mutex<HashMap<String, Weak<Feed>>>,
    sockets: Arc<Semaphore>,
}
impl Default for MetricsHub {
    fn default() -> Self {
        Self::new()
    }
}
struct Feed {
    receiver: watch::Receiver<Option<Arc<Value>>>,
    sampling: MetricsSampling,
    viewers: std::sync::Mutex<HashMap<uuid::Uuid, u64>>,
}
struct Subscription {
    feed: Arc<Feed>,
    id: uuid::Uuid,
}
impl Feed {
    fn subscribe(self: &Arc<Self>, interval: u64) -> Subscription {
        let id = uuid::Uuid::new_v4();
        let mut viewers = self
            .viewers
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        viewers.insert(id, interval);
        self.sampling
            .set_interval_ms(viewers.values().copied().min().unwrap_or(1000));
        Subscription {
            feed: self.clone(),
            id,
        }
    }
}
impl Drop for Subscription {
    fn drop(&mut self) {
        let mut viewers = self
            .feed
            .viewers
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        viewers.remove(&self.id);
        self.feed
            .sampling
            .set_interval_ms(viewers.values().copied().min().unwrap_or(1000));
    }
}
impl MetricsHub {
    pub fn new() -> Self {
        Self {
            feeds: Mutex::default(),
            sockets: Arc::new(Semaphore::new(32)),
        }
    }
    async fn subscribe(
        &self,
        servers: &Arc<dyn ServerService>,
        id: &str,
        interval: u64,
    ) -> Result<Subscription, ApiError> {
        let mut feeds = self.feeds.lock().await;
        feeds.retain(|_, feed| feed.strong_count() > 0);
        if let Some(feed) = feeds.get(id).and_then(Weak::upgrade) {
            return Ok(feed.subscribe(interval));
        }
        if feeds.len() >= 16 {
            return Err(busy());
        }
        let sampling = MetricsSampling::new(interval);
        let mut stream = servers.metrics_stream_at(id, sampling.clone()).await?;
        let (sender, receiver) = watch::channel(None);
        let feed = Arc::new(Feed {
            receiver,
            sampling,
            viewers: std::sync::Mutex::default(),
        });
        let subscription = feed.subscribe(interval);
        feeds.insert(id.into(), Arc::downgrade(&feed));
        tokio::spawn(async move {
            let mut last_sample = String::new();
            loop {
                tokio::select! {
                    _=sender.closed()=>break,
                    sample=tokio::time::timeout(Duration::from_secs(75),stream.next())=> {
                        let frame = match sample {
                            Ok(Some(Ok(sample))) => {
                                if sample.sampled_at == last_sample { continue; }
                                last_sample.clone_from(&sample.sampled_at);
                                json!({"type":"sample","sample":sample})
                            },
                            Ok(Some(Err(error))) => json!({"type":"error","code":error.code(),"detail":error.public_detail()}),
                            Ok(None) => json!({"type":"end"}),
                            Err(_) => json!({"type":"error","code":ServerError::DockerUnavailable.code(),"detail":"The Docker metrics stream timed out."}),
                        };
                        let terminal = frame["type"] != "sample";
                        if sender.send(Some(Arc::new(frame))).is_err() || terminal { break; }
                    }
                }
            }
        });
        Ok(subscription)
    }
}
fn busy() -> ApiError {
    ApiError::new(
        StatusCode::TOO_MANY_REQUESTS,
        "metrics.busy",
        "All live metrics slots are occupied.",
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn collection_tracks_fastest_viewer_and_slows_after_disconnect() {
        let (_sender, receiver) = watch::channel(None);
        let feed = Arc::new(Feed {
            receiver,
            sampling: MetricsSampling::new(1000),
            viewers: std::sync::Mutex::default(),
        });
        let slow = feed.subscribe(5000);
        assert_eq!(feed.sampling.interval_ms(), 5000);
        let fast = feed.subscribe(100);
        let medium = feed.subscribe(250);
        assert_eq!(feed.sampling.interval_ms(), 100);
        drop(fast);
        assert_eq!(feed.sampling.interval_ms(), 250);
        drop(medium);
        assert_eq!(feed.sampling.interval_ms(), 5000);
        let weak = Arc::downgrade(&feed);
        drop(feed);
        assert!(weak.upgrade().is_some());
        drop(slow);
        assert!(weak.upgrade().is_none());
    }
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Settings {
    interval_ms: Option<u64>,
}
pub(crate) async fn upgrade(
    State(state): State<AppState>,
    Path(id): Path<String>,
    query: Result<Query<Settings>, axum::extract::rejection::QueryRejection>,
    headers: HeaderMap,
    ws: WebSocketUpgrade,
) -> Result<Response, ApiError> {
    let Query(settings) = query.map_err(|_| {
        ApiError::new(
            StatusCode::BAD_REQUEST,
            "validation",
            "Invalid metrics stream query.",
        )
    })?;
    let interval = settings.interval_ms.unwrap_or(1000);
    if !(100..=60000).contains(&interval) {
        return Err(ApiError::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            "validation",
            "intervalMs must be between 100 and 60000.",
        ));
    }
    if headers.get("origin").and_then(|v| v.to_str().ok()) != Some(state.origin.as_str()) {
        return Err(ApiError::new(
            StatusCode::FORBIDDEN,
            "auth.csrf",
            "A matching Origin is required for metrics streaming.",
        ));
    }
    let permit = state
        .metrics
        .sockets
        .clone()
        .try_acquire_owned()
        .map_err(|_| busy())?;
    let feed = state
        .metrics
        .subscribe(&state.servers, &id, interval)
        .await?;
    let token = auth::session_cookie(&headers).map(str::to_owned);
    let bearer = auth::bearer(&headers)?.map(str::to_owned);
    Ok(ws
        .max_message_size(1024)
        .max_frame_size(1024)
        .write_buffer_size(0)
        .max_write_buffer_size(64 * 1024)
        .on_upgrade(move |socket| async move {
            let _permit = permit;
            serve(socket, state, feed, token, bearer, interval).await;
        }))
}
async fn serve(
    socket: WebSocket,
    state: AppState,
    feed: Subscription,
    token: Option<String>,
    bearer: Option<String>,
    interval: u64,
) {
    let (mut writer, mut reader) = socket.split();
    let mut samples = feed.feed.receiver.clone();
    let mut ticks = tokio::time::interval(Duration::from_millis(interval));
    ticks.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    let mut heartbeat = tokio::time::interval(Duration::from_secs(5));
    heartbeat.tick().await;
    let mut last_pong = tokio::time::Instant::now();
    loop {
        tokio::select! {
            _=ticks.tick()=>{
                let changed=samples.has_changed();
                if changed.as_ref().is_ok_and(|changed|!*changed){continue;}
                let frame=samples.borrow_and_update().clone();
                if let Some(frame)=frame {
                    if !matches!(tokio::time::timeout(Duration::from_secs(5),writer.send(Message::Text(frame.to_string().into()))).await,Ok(Ok(()))) {break;}
                    if frame["type"]!="sample"{break;}
                }
                if changed.is_err(){break;}
            },
            incoming=reader.next()=>match incoming {
                Some(Ok(Message::Pong(_)))=>last_pong=tokio::time::Instant::now(),
                Some(Ok(Message::Ping(data)))=>{if !matches!(tokio::time::timeout(Duration::from_secs(5),writer.send(Message::Pong(data))).await,Ok(Ok(()))){break;}},
                _=>break,
            },
            _=heartbeat.tick()=>{
                let valid=tokio::time::timeout(Duration::from_secs(5),async {
                    if let Some(key)=&bearer {state.auth.authenticate_api_key(key,!state.auth_enabled).await.is_ok()}else{!state.auth_enabled || match &token {Some(token)=>state.auth.authenticate(token).await.is_ok(),None=>false}}
                }).await.unwrap_or(false);
                if !valid {
                    let _=tokio::time::timeout(Duration::from_secs(5),writer.send(Message::Text(json!({"type":"error","code":"auth.required","detail":"Sign in to continue."}).to_string().into()))).await;
                    break;
                }
                if last_pong.elapsed()>Duration::from_secs(45){break;}
                if !matches!(tokio::time::timeout(Duration::from_secs(5),writer.send(Message::Ping(vec![].into()))).await,Ok(Ok(()))){break;}
            }
        }
    }
    let _ = tokio::time::timeout(Duration::from_secs(2), writer.send(Message::Close(None))).await;
}
