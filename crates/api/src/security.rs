use crate::{AppState, error::ApiError};
use axum::{
    extract::{Request, State},
    http::{HeaderMap, HeaderValue, Method, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
};
use uuid::Uuid;

pub(crate) async fn secure(
    State(state): State<AppState>,
    mut request: Request,
    next: Next,
) -> Response {
    let request_id = Uuid::new_v4().to_string();
    let checked = async {
        // Validate browser origin/host before any credential/database work.
        check(&state, &Method::GET, request.headers(), false)?;
        let actor = match crate::auth::bearer(request.headers())? {
            Some(token) => Some(
                state
                    .auth
                    .authenticate_api_key(token, !state.auth_enabled)
                    .await?,
            ),
            None => None,
        };
        check(&state, request.method(), request.headers(), actor.is_some())?;
        if let Some(actor) = actor {
            request.extensions_mut().insert(actor);
        }
        Ok::<(), ApiError>(())
    }
    .await;
    let mut response = match checked {
        Ok(()) => next.run(request).await,
        Err(error) => error.into_response(),
    };
    let headers = response.headers_mut();
    for (name, value) in [
        ("x-content-type-options", "nosniff"),
        ("x-frame-options", "DENY"),
        ("referrer-policy", "no-referrer"),
        (
            "permissions-policy",
            "camera=(), microphone=(), geolocation=()",
        ),
    ] {
        headers.insert(name, HeaderValue::from_static(value));
    }
    // Static handlers provide their page policy/cache rules; API handlers retain
    // the restrictive defaults. All routes still share the request checks above.
    headers
        .entry("cache-control")
        .or_insert(HeaderValue::from_static("no-store"));
    headers
        .entry("content-security-policy")
        .or_insert(HeaderValue::from_static(
            "default-src 'none'; frame-ancestors 'none'",
        ));
    if state.secure_cookie {
        headers.insert(
            "strict-transport-security",
            HeaderValue::from_static("max-age=31536000"),
        );
    }
    if let Ok(value) = HeaderValue::from_str(&request_id) {
        headers.insert("x-request-id", value);
    }
    response
}
fn check(
    state: &AppState,
    method: &Method,
    headers: &HeaderMap,
    bearer: bool,
) -> Result<(), ApiError> {
    let authority = state.origin.split_once("://").map(|(_, host)| host);
    let host = headers.get("host").and_then(|h| h.to_str().ok());
    if host != authority {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "http.host",
            "The request host does not match the configured public URL.",
        ));
    }
    let origin = headers.get("origin").and_then(|h| h.to_str().ok());
    if headers
        .get("sec-fetch-site")
        .is_some_and(|h| h == "cross-site")
        || origin.is_some_and(|o| o != state.origin)
    {
        return Err(csrf());
    }
    if !bearer && !matches!(*method, Method::GET | Method::HEAD | Method::OPTIONS) {
        let referer_origin = headers
            .get("referer")
            .and_then(|h| h.to_str().ok())
            .and_then(|s| url::Url::parse(s).ok())
            .map(|u| u.origin().ascii_serialization());
        if headers.get("x-mcm-csrf").is_none_or(|h| h != "1")
            || (origin != Some(state.origin.as_str())
                && referer_origin.as_deref() != Some(state.origin.as_str()))
        {
            return Err(csrf());
        }
    }
    Ok(())
}
fn csrf() -> ApiError {
    ApiError::new(
        StatusCode::FORBIDDEN,
        "auth.csrf",
        "A same-origin request and X-MCM-CSRF: 1 are required.",
    )
}
