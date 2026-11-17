use crate::common::TestApp;
use axum::{
    body::Bytes,
    extract::{Path, State},
    http::StatusCode,
};
use serde_json::Value;
use std::{
    collections::HashMap,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
};
pub(super) type Result<T = ()> = std::result::Result<T, Box<dyn std::error::Error>>;
#[derive(Clone, Default)]
pub(super) struct Store {
    pub(super) objects: Arc<Mutex<HashMap<String, Vec<u8>>>>,
    pub(super) corrupt: Arc<AtomicBool>,
}
pub(super) async fn save(
    State(s): State<Store>,
    Path(key): Path<String>,
    bytes: Bytes,
) -> StatusCode {
    s.objects
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .insert(key, bytes.to_vec());
    StatusCode::OK
}
pub(super) async fn read(State(s): State<Store>, Path(key): Path<String>) -> (StatusCode, Vec<u8>) {
    match s
        .objects
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .get(&key)
    {
        Some(bytes) => {
            let mut bytes = bytes.clone();
            if s.corrupt.load(Ordering::Relaxed)
                && let Some(first) = bytes.first_mut()
            {
                *first ^= 1;
            }
            (StatusCode::OK, bytes)
        }
        None => (StatusCode::NOT_FOUND, vec![]),
    }
}
pub(super) async fn remove(State(s): State<Store>, Path(key): Path<String>) -> StatusCode {
    s.objects
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .remove(&key);
    StatusCode::NO_CONTENT
}
pub(super) async fn completed(app: &TestApp, body: Value) -> Result<Value> {
    let id = body["job"]["id"].as_str().ok_or("job id")?;
    for _ in 0..200 {
        let job: Value = app
            .client
            .get(format!("{}/api/v1/jobs/{id}", app.base))
            .send()
            .await?
            .json()
            .await?;
        if job["state"] == "succeeded" || job["state"] == "failed" {
            return Ok(job);
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    Err("timeout".into())
}
