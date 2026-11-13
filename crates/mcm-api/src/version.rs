use crate::{AppState, error::ApiError};
use axum::{Json, extract::State, http::StatusCode};
use serde_json::{Value, json};

pub(crate) async fn version(State(state): State<AppState>) -> Json<Value> {
    if state.show_version {
        Json(json!({"enabled":true,"version":env!("CARGO_PKG_VERSION"),"channel":"development"}))
    } else {
        Json(json!({"enabled":false,"version":null,"channel":null}))
    }
}
pub(crate) async fn changelog(State(state): State<AppState>) -> Result<Json<Value>, ApiError> {
    if !state.show_version {
        return Err(ApiError::new(
            StatusCode::NOT_FOUND,
            "version.disabled",
            "Version information is disabled.",
        ));
    }
    Ok(Json(
        json!({"version":env!("CARGO_PKG_VERSION"),"markdown":include_str!("../../../CHANGELOG.md")}),
    ))
}
