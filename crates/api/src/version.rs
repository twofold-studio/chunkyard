use crate::dto::*;
use crate::{AppState, error::ApiError};
use axum::{Json, extract::State, http::StatusCode};

#[utoipa::path(get, path = "/api/v1/system/version", operation_id = "version_version", tag = "version", responses((status = 200, description = "Success", body = VersionInfo), (status = "default", description = "Request rejected", body = crate::error::Problem, content_type = "application/problem+json"))) ]
pub(crate) async fn version(State(state): State<AppState>) -> Json<VersionInfo> {
    if state.show_version {
        Json(VersionInfo {
            enabled: true,
            version: Some(env!("CARGO_PKG_VERSION")),
            channel: Some("development"),
        })
    } else {
        Json(VersionInfo {
            enabled: false,
            version: None,
            channel: None,
        })
    }
}
#[utoipa::path(get, path = "/api/v1/system/changelog", operation_id = "version_changelog", tag = "version", responses((status = 200, description = "Success", body = Changelog), (status = "default", description = "Request rejected", body = crate::error::Problem, content_type = "application/problem+json"))) ]
pub(crate) async fn changelog(State(state): State<AppState>) -> Result<Json<Changelog>, ApiError> {
    if !state.show_version {
        return Err(ApiError::new(
            StatusCode::NOT_FOUND,
            "version.disabled",
            "Version information is disabled.",
        ));
    }
    Ok(Json(Changelog {
        version: env!("CARGO_PKG_VERSION"),
        markdown: include_str!("../../../CHANGELOG.md"),
    }))
}
