use crate::dto::*;
use crate::{AppState, error::ApiError, json::ApiJson};
use axum::{
    Extension, Json,
    extract::{ConnectInfo, Path, Request, State},
    http::{HeaderMap, HeaderValue, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
};
use chunkyard_auth::IssuedSession;
use chunkyard_core::auth::{Actor, Session};
use serde::Deserialize;

use std::net::SocketAddr;

#[derive(Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SetupRequest {
    setup_token: String,
    email: String,
    password: String,
}
#[derive(Deserialize, utoipa::ToSchema)]
#[serde(deny_unknown_fields)]
pub(crate) struct LoginRequest {
    email: String,
    password: String,
}

#[utoipa::path(get, path = "/api/v1/setup/status", operation_id = "auth_setup_status", tag = "auth", responses((status = 200, description = "Success", body = SetupStatus), (status = "default", description = "Request rejected", body = crate::error::Problem, content_type = "application/problem+json"))) ]
pub(crate) async fn setup_status(
    State(state): State<AppState>,
) -> Result<Json<SetupStatus>, ApiError> {
    Ok(Json(SetupStatus {
        required: state.auth_enabled && state.auth.setup_required().await?,
        auth_enabled: state.auth_enabled,
    }))
}
#[derive(Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct VerifySetupTokenRequest {
    setup_token: String,
}
#[utoipa::path(post, path = "/api/v1/setup/verify-token", operation_id = "auth_verify_setup_token", tag = "auth", request_body = VerifySetupTokenRequest, responses((status = 204, description = "Success"), (status = "default", description = "Request rejected", body = crate::error::Problem, content_type = "application/problem+json"))) ]
pub(crate) async fn verify_setup_token(
    State(state): State<AppState>,
    ApiJson(body): ApiJson<VerifySetupTokenRequest>,
) -> Result<StatusCode, ApiError> {
    if !state.auth_enabled {
        return Err(auth_disabled());
    }
    state.auth.verify_setup_token(&body.setup_token).await?;
    Ok(StatusCode::NO_CONTENT)
}
#[utoipa::path(post, path = "/api/v1/setup", operation_id = "auth_setup", tag = "auth", request_body = SetupRequest, responses((status = 201, description = "Success", body = Me), (status = "default", description = "Request rejected", body = crate::error::Problem, content_type = "application/problem+json"))) ]
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
#[utoipa::path(post, path = "/api/v1/auth/login", operation_id = "auth_login", tag = "auth", request_body = LoginRequest, responses((status = 200, description = "Success", body = LoginResponse), (status = "default", description = "Request rejected", body = crate::error::Problem, content_type = "application/problem+json"))) ]
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
#[utoipa::path(get, path = "/api/v1/auth/me", operation_id = "auth_me", tag = "auth", responses((status = 200, description = "Success", body = Me), (status = "default", description = "Request rejected", body = crate::error::Problem, content_type = "application/problem+json"))) ]
pub(crate) async fn me(Extension(actor): Extension<Actor>) -> Json<Me> {
    Json(match actor {
        Actor::Session(session) => me_json(&session),
        Actor::ApiKey(user) => Me {
            auth_enabled: true,
            user,
            principal: Principal {
                kind: PrincipalKind::ApiKey,
            },
            is_admin: true,
            must_change_password: None,
            totp_enabled: None,
        },
        Actor::AuthDisabled => Me {
            auth_enabled: false,
            user: None,
            principal: Principal {
                kind: PrincipalKind::AuthDisabled,
            },
            is_admin: true,
            must_change_password: None,
            totp_enabled: None,
        },
    })
}
#[utoipa::path(post, path = "/api/v1/auth/logout", operation_id = "auth_logout", tag = "auth", responses((status = 204, description = "Success"), (status = "default", description = "Request rejected", body = crate::error::Problem, content_type = "application/problem+json"))) ]
pub(crate) async fn logout(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Response, ApiError> {
    if state.auth_enabled {
        let token = session_cookie(&headers).ok_or(chunkyard_auth::AuthError::Required)?;
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
    if request
        .extensions()
        .get::<Actor>()
        .is_some_and(|actor| matches!(actor, Actor::ApiKey(_)))
    {
        return Ok(next.run(request).await);
    }
    if !state.auth_enabled {
        request.extensions_mut().insert(Actor::AuthDisabled);
        return Ok(next.run(request).await);
    }
    if state.auth.setup_required().await? {
        return Err(chunkyard_auth::AuthError::SetupRequired.into());
    }
    let token = session_cookie(request.headers()).ok_or(chunkyard_auth::AuthError::Required)?;
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

#[derive(Deserialize, utoipa::ToSchema)]
#[serde(deny_unknown_fields)]
pub(crate) struct CreateKey {
    name: String,
}

fn browser_only(actor: &Actor) -> Result<(), ApiError> {
    if matches!(actor, Actor::ApiKey(_)) {
        return Err(ApiError::new(
            StatusCode::FORBIDDEN,
            "auth.session_required",
            "Use a browser session to manage API keys.",
        ));
    }
    Ok(())
}
#[utoipa::path(get, path = "/api/v1/auth/api-keys", operation_id = "auth_api_keys", tag = "auth", responses((status = 200, description = "Success", body = Items<chunkyard_core::auth::ApiKey>), (status = "default", description = "Request rejected", body = crate::error::Problem, content_type = "application/problem+json"))) ]
pub(crate) async fn api_keys(
    State(state): State<AppState>,
    Extension(actor): Extension<Actor>,
) -> Result<Json<Items<chunkyard_core::auth::ApiKey>>, ApiError> {
    browser_only(&actor)?;
    Ok(Json(Items {
        items: state.auth.api_keys().await?,
    }))
}
#[utoipa::path(post, path = "/api/v1/auth/api-keys", operation_id = "auth_create_api_key", tag = "auth", request_body = CreateKey, responses((status = 201, description = "Success", body = CreatedApiKey), (status = "default", description = "Request rejected", body = crate::error::Problem, content_type = "application/problem+json"))) ]
pub(crate) async fn create_api_key(
    State(state): State<AppState>,
    Extension(actor): Extension<Actor>,
    ApiJson(body): ApiJson<CreateKey>,
) -> Result<(StatusCode, Json<CreatedApiKey>), ApiError> {
    browser_only(&actor)?;
    let (key, token) = state
        .auth
        .issue_api_key(&body.name, actor.user_id())
        .await?;
    Ok((StatusCode::CREATED, Json(CreatedApiKey { key, token })))
}
#[utoipa::path(delete, path = "/api/v1/auth/api-keys/{id}", operation_id = "auth_revoke_api_key", tag = "auth", params(("id" = String, Path)), responses((status = 204, description = "Success"), (status = "default", description = "Request rejected", body = crate::error::Problem, content_type = "application/problem+json"))) ]
pub(crate) async fn revoke_api_key(
    State(state): State<AppState>,
    Extension(actor): Extension<Actor>,
    Path(id): Path<String>,
) -> Result<StatusCode, ApiError> {
    browser_only(&actor)?;
    state.auth.revoke_api_key(&id).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Explicit bearer authentication; never fall back to cookies for a bad header.
pub(crate) fn bearer(headers: &HeaderMap) -> Result<Option<&str>, ApiError> {
    let mut values = headers.get_all("authorization").iter();
    let Some(value) = values.next() else {
        return Ok(None);
    };
    if values.next().is_some() || session_cookie(headers).is_some() {
        return Err(chunkyard_auth::AuthError::Required.into());
    }
    let token = value
        .to_str()
        .ok()
        .and_then(|s| s.strip_prefix("Bearer "))
        .filter(|s| !s.is_empty())
        .ok_or(chunkyard_auth::AuthError::Required)?;
    Ok(Some(token))
}
#[utoipa::path(get, path = "/healthz", operation_id = "auth_health", tag = "auth", responses((status = 200, description = "Success", body = Health), (status = 503, description = "Database unavailable", body = Health), (status = "default", description = "Request rejected", body = crate::error::Problem, content_type = "application/problem+json"))) ]
pub(crate) async fn health(State(state): State<AppState>) -> (StatusCode, Json<Health>) {
    if state.health.healthy().await {
        (StatusCode::OK, Json(Health { status: "ok" }))
    } else {
        (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(Health {
                status: "db_unavailable",
            }),
        )
    }
}
pub(crate) fn session_cookie(headers: &HeaderMap) -> Option<&str> {
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
    let mut response = if setup {
        (StatusCode::CREATED, Json(me_json(&issued.session))).into_response()
    } else {
        (
            StatusCode::OK,
            Json(LoginResponse {
                kind: LoginKind::Session,
                me: me_json(&issued.session),
            }),
        )
            .into_response()
    };
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
fn me_json(session: &Session) -> Me {
    Me {
        auth_enabled: true,
        user: Some(session.user.clone()),
        principal: Principal {
            kind: PrincipalKind::Session,
        },
        is_admin: true,
        must_change_password: Some(false),
        totp_enabled: Some(false),
    }
}

fn auth_disabled() -> ApiError {
    ApiError::new(
        StatusCode::CONFLICT,
        "auth.disabled",
        "Authentication is disabled by configuration.",
    )
}
