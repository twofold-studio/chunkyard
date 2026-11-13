use crate::{AppState, error::ApiError, json::ApiJson};
use axum::{
    Extension, Json,
    extract::{ConnectInfo, Request, State},
    http::{HeaderMap, HeaderValue, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
};
use mcm_auth::IssuedSession;
use mcm_core::auth::{Actor, Session};
use serde::Deserialize;
use serde_json::{Value, json};
use std::net::SocketAddr;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SetupRequest {
    setup_token: String,
    email: String,
    password: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct LoginRequest {
    email: String,
    password: String,
}

pub(crate) async fn setup_status(State(state): State<AppState>) -> Result<Json<Value>, ApiError> {
    Ok(Json(
        json!({"required": state.auth_enabled && state.auth.setup_required().await?, "authEnabled": state.auth_enabled}),
    ))
}
pub(crate) async fn setup(
    State(state): State<AppState>,
    ApiJson(body): ApiJson<SetupRequest>,
) -> Result<Response, ApiError> {
    if !state.auth_enabled {
        return Err(auth_disabled());
    }
    let issued = state
        .auth
        .setup(&body.setup_token, &body.email, body.password)
        .await?;
    session_response(&state, issued, true)
}
pub(crate) async fn login(
    State(state): State<AppState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    ApiJson(body): ApiJson<LoginRequest>,
) -> Result<Response, ApiError> {
    if !state.auth_enabled {
        return Err(auth_disabled());
    }
    let issued = state
        .auth
        .login(&body.email, body.password, peer.ip())
        .await?;
    session_response(&state, issued, false)
}
pub(crate) async fn me(Extension(actor): Extension<Actor>) -> Json<Value> {
    Json(match actor {
        Actor::Session(session) => me_json(&session),
        Actor::AuthDisabled => {
            json!({"authEnabled":false, "user":null, "principal":{"kind":"auth_disabled"}, "isAdmin":true})
        }
    })
}
pub(crate) async fn logout(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Response, ApiError> {
    if state.auth_enabled {
        let token = session_cookie(&headers).ok_or(mcm_auth::AuthError::Required)?;
        state.auth.logout(token).await?;
    }
    let mut response = StatusCode::NO_CONTENT.into_response();
    response
        .headers_mut()
        .insert("set-cookie", cookie(&state, "", true)?);
    Ok(response)
}
pub(crate) async fn require_session(
    State(state): State<AppState>,
    mut request: Request,
    next: Next,
) -> Result<Response, ApiError> {
    if !state.auth_enabled {
        request.extensions_mut().insert(Actor::AuthDisabled);
        return Ok(next.run(request).await);
    }
    if state.auth.setup_required().await? {
        return Err(mcm_auth::AuthError::SetupRequired.into());
    }
    let token = session_cookie(request.headers()).ok_or(mcm_auth::AuthError::Required)?;
    let session = state.auth.authenticate(token).await?;
    if !matches!(session.user.role.as_str(), "owner" | "admin") {
        return Err(ApiError::new(
            StatusCode::FORBIDDEN,
            "auth.forbidden",
            "An administrator account is required.",
        ));
    }
    request.extensions_mut().insert(Actor::Session(session));
    Ok(next.run(request).await)
}
pub(crate) async fn health(State(state): State<AppState>) -> (StatusCode, Json<Value>) {
    if state.health.healthy().await {
        (StatusCode::OK, Json(json!({"status":"ok"})))
    } else {
        (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({"status":"db_unavailable"})),
        )
    }
}
fn session_cookie(headers: &HeaderMap) -> Option<&str> {
    let mut found = None;
    for value in headers.get_all("cookie") {
        for part in value.to_str().ok()?.split(';') {
            if let Some(("mcm_session", token)) = part.trim().split_once('=') {
                if found.is_some() {
                    return None;
                }
                found = Some(token);
            }
        }
    }
    found
}
fn session_response(
    state: &AppState,
    issued: IssuedSession,
    setup: bool,
) -> Result<Response, ApiError> {
    let body = if setup {
        me_json(&issued.session)
    } else {
        json!({"kind":"session", "me":me_json(&issued.session)})
    };
    let mut response = (
        if setup {
            StatusCode::CREATED
        } else {
            StatusCode::OK
        },
        Json(body),
    )
        .into_response();
    response
        .headers_mut()
        .insert("set-cookie", cookie(state, &issued.token, false)?);
    Ok(response)
}
fn cookie(state: &AppState, token: &str, clear: bool) -> Result<HeaderValue, ApiError> {
    let value = format!(
        "mcm_session={token}; HttpOnly; SameSite=Lax; Path=/; Max-Age={}{}",
        if clear { 0 } else { 30 * 86400 },
        if state.secure_cookie { "; Secure" } else { "" }
    );
    HeaderValue::from_str(&value).map_err(ApiError::internal)
}
fn me_json(session: &Session) -> Value {
    json!({"authEnabled":true, "user":session.user, "principal":{"kind":"session"}, "mustChangePassword":false, "totpEnabled":false, "isAdmin":true})
}

fn auth_disabled() -> ApiError {
    ApiError::new(
        StatusCode::CONFLICT,
        "auth.disabled",
        "Authentication is disabled by configuration.",
    )
}
