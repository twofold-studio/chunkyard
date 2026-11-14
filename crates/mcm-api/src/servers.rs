use crate::{AppState, error::ApiError, json::ApiJson};
use axum::{
    Extension, Json,
    extract::{Path, Query, State},
    http::{HeaderValue, StatusCode},
    response::{IntoResponse, Response},
};
use mcm_core::{auth::Actor, jobs::JobFailure, server::CreateServer};
use serde::Deserialize;
use serde_json::{Value, json};
pub(crate) async fn launch_settings(
    State(s): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    Ok(Json(json!(s.servers.launch_settings(&id).await?)))
}
pub(crate) async fn set_launch(
    State(s): State<AppState>,
    Path(id): Path<String>,
    ApiJson(body): ApiJson<mcm_core::server::LaunchUpdate>,
) -> Result<Json<Value>, ApiError> {
    Ok(Json(
        json!({"server":s.servers.set_launch(&id,body).await?}),
    ))
}

pub(crate) async fn set_resources(
    State(state): State<AppState>,
    Path(id): Path<String>,
    ApiJson(body): ApiJson<mcm_core::server::ResourceUpdate>,
) -> Result<Json<Value>, ApiError> {
    Ok(Json(
        json!({"server":state.servers.set_resources(&id,body).await?}),
    ))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct LogsQuery {
    tail: Option<u32>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CommandRequest {
    line: String,
}

pub(crate) async fn create(
    State(state): State<AppState>,
    ApiJson(body): ApiJson<CreateServer>,
) -> Result<Response, ApiError> {
    let server = state.servers.create(body).await?;
    let location = format!("/api/v1/servers/{}", server.server.id);
    let mut response = (StatusCode::CREATED, Json(json!({"server":server}))).into_response();
    response.headers_mut().insert(
        "location",
        HeaderValue::from_str(&location).map_err(ApiError::internal)?,
    );
    Ok(response)
}
pub(crate) async fn list(State(state): State<AppState>) -> Result<Json<Value>, ApiError> {
    Ok(Json(json!({"items":state.servers.list().await?})))
}
pub(crate) async fn get(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    Ok(Json(json!(state.servers.get(&id).await?)))
}

pub(crate) async fn network(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    Ok(Json(json!(state.servers.network(&id).await?)))
}

pub(crate) async fn set_network(
    State(state): State<AppState>,
    Path(id): Path<String>,
    ApiJson(body): ApiJson<mcm_core::server::NetworkUpdate>,
) -> Result<Json<Value>, ApiError> {
    Ok(Json(
        json!({"server":state.servers.set_network(&id,body).await?}),
    ))
}
pub(crate) async fn metrics(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    Ok(Json(json!(state.servers.metrics(&id).await?)))
}
pub(crate) async fn isolation(State(state): State<AppState>) -> Json<Value> {
    Json(json!({"docker":state.servers.runtime_info().await}))
}
pub(crate) async fn logs(
    State(state): State<AppState>,
    Path(id): Path<String>,
    query: Result<Query<LogsQuery>, axum::extract::rejection::QueryRejection>,
) -> Result<Json<Value>, ApiError> {
    let Query(query) = query.map_err(|_| {
        ApiError::new(
            StatusCode::BAD_REQUEST,
            "validation",
            "Invalid console query.",
        )
    })?;
    Ok(Json(
        json!({"items":state.servers.logs(&id, query.tail.unwrap_or(200)).await?}),
    ))
}
pub(crate) async fn command(
    State(state): State<AppState>,
    Path(id): Path<String>,
    ApiJson(body): ApiJson<CommandRequest>,
) -> Result<StatusCode, ApiError> {
    state.servers.command(&id, &body.line).await?;
    Ok(StatusCode::NO_CONTENT)
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct EulaRequest {
    accepted: bool,
}
pub(crate) async fn eula(
    State(state): State<AppState>,
    Path(id): Path<String>,
    ApiJson(body): ApiJson<EulaRequest>,
) -> Result<Json<Value>, ApiError> {
    Ok(Json(
        json!({"server":state.servers.set_eula(&id,body.accepted).await?}),
    ))
}
#[derive(Clone)]
enum Action {
    Delete { delete_files: bool },
    Install(mcm_core::software::InstallOptions),
    Start,
    Stop,
    Restart,
    Kill,
}
async fn action(
    state: AppState,
    actor: Actor,
    id: String,
    action: Action,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    // Reject unknown IDs synchronously instead of enqueueing an unresolvable job.
    state.servers.get(&id).await?;
    let kind = match action {
        Action::Delete { .. } => "server.delete",
        Action::Install(_) => "server.install",
        Action::Start => "server.start",
        Action::Stop => "server.stop",
        Action::Restart => "server.restart",
        Action::Kill => "server.kill",
    };
    let servers = state.servers.clone();
    let job_server_id = id.clone();
    let job = state
        .jobs
        .submit_for_server(
            kind,
            &job_server_id,
            actor.user_id(),
            Box::pin(async move {
                let result = match action {
                    Action::Delete { delete_files } => {
                        return servers
                            .delete(&id, delete_files)
                            .await
                            .map(|deleted| json!({"deleted":deleted}))
                            .map_err(job_failure);
                    }
                    Action::Install(options) => servers.install_with_options(&id, options).await,
                    Action::Start => servers.start(&id).await,
                    Action::Stop => servers.stop(&id).await,
                    Action::Restart => servers.restart(&id).await,
                    Action::Kill => servers.kill(&id).await,
                };
                result
                    .map(|server| json!({"server":server}))
                    .map_err(|error| JobFailure {
                        code: error.code().into(),
                        detail: error.public_detail(),
                    })
            }),
        )
        .await?;
    Ok((StatusCode::ACCEPTED, Json(json!({"job":job}))))
}
pub(crate) async fn start(
    State(state): State<AppState>,
    Extension(actor): Extension<Actor>,
    Path(id): Path<String>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    action(state, actor, id, Action::Start).await
}
pub(crate) async fn stop(
    State(state): State<AppState>,
    Extension(actor): Extension<Actor>,
    Path(id): Path<String>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    action(state, actor, id, Action::Stop).await
}
pub(crate) async fn restart(
    State(state): State<AppState>,
    Extension(actor): Extension<Actor>,
    Path(id): Path<String>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    action(state, actor, id, Action::Restart).await
}
pub(crate) async fn kill(
    State(state): State<AppState>,
    Extension(actor): Extension<Actor>,
    Path(id): Path<String>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    action(state, actor, id, Action::Kill).await
}

pub(crate) async fn install(
    State(state): State<AppState>,
    Extension(actor): Extension<Actor>,
    Path(id): Path<String>,
    body: axum::body::Bytes,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let options = if body.is_empty() {
        Default::default()
    } else {
        serde_json::from_slice(&body).map_err(|_| {
            ApiError::new(
                StatusCode::UNPROCESSABLE_ENTITY,
                "validation",
                "Invalid installer options.",
            )
        })?
    };
    action(state, actor, id, Action::Install(options)).await
}

fn job_failure(error: mcm_core::server::ServerError) -> JobFailure {
    JobFailure {
        code: error.code().into(),
        detail: error.public_detail(),
    }
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct DeleteQuery {
    #[serde(default)]
    delete_files: bool,
}
pub(crate) async fn delete(
    State(state): State<AppState>,
    Extension(actor): Extension<Actor>,
    Path(id): Path<String>,
    query: Result<Query<DeleteQuery>, axum::extract::rejection::QueryRejection>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let Query(query) = query.map_err(|_| {
        ApiError::new(
            StatusCode::BAD_REQUEST,
            "validation",
            "Invalid deletion query; deleteFiles must be true or false.",
        )
    })?;
    action(
        state,
        actor,
        id,
        Action::Delete {
            delete_files: query.delete_files,
        },
    )
    .await
}
