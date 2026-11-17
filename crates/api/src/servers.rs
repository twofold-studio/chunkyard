use crate::dto::*;
use crate::{AppState, error::ApiError, json::ApiJson};
use axum::{
    Extension, Json,
    extract::{Path, Query, State},
    http::{HeaderValue, StatusCode},
    response::{IntoResponse, Response},
};
use chunkyard_core::{auth::Actor, jobs::JobFailure, server::CreateServer};
use serde::Deserialize;
use serde_json::json;
#[utoipa::path(get, path = "/api/v1/servers/{id}/launch", operation_id = "servers_launch_settings", tag = "servers", params(("id" = String, Path)), responses((status = 200, description = "Success", body = chunkyard_core::server::LaunchSettings), (status = "default", description = "Request rejected", body = crate::error::Problem, content_type = "application/problem+json"))) ]
pub(crate) async fn launch_settings(
    State(s): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<chunkyard_core::server::LaunchSettings>, ApiError> {
    Ok(Json(s.servers.launch_settings(&id).await?))
}
#[utoipa::path(patch, path = "/api/v1/servers/{id}/launch", operation_id = "servers_set_launch", tag = "servers", params(("id" = String, Path)), request_body = chunkyard_core::server::LaunchUpdate, responses((status = 200, description = "Success", body = ServerResponse), (status = "default", description = "Request rejected", body = crate::error::Problem, content_type = "application/problem+json"))) ]
pub(crate) async fn set_launch(
    State(s): State<AppState>,
    Path(id): Path<String>,
    ApiJson(body): ApiJson<chunkyard_core::server::LaunchUpdate>,
) -> Result<Json<ServerResponse>, ApiError> {
    Ok(Json(ServerResponse {
        server: s.servers.set_launch(&id, body).await?,
    }))
}

#[utoipa::path(patch, path = "/api/v1/servers/{id}/resources", operation_id = "servers_set_resources", tag = "servers", params(("id" = String, Path)), request_body = chunkyard_core::server::ResourceUpdate, responses((status = 200, description = "Success", body = ServerResponse), (status = "default", description = "Request rejected", body = crate::error::Problem, content_type = "application/problem+json"))) ]
pub(crate) async fn set_resources(
    State(state): State<AppState>,
    Path(id): Path<String>,
    ApiJson(body): ApiJson<chunkyard_core::server::ResourceUpdate>,
) -> Result<Json<ServerResponse>, ApiError> {
    Ok(Json(ServerResponse {
        server: state.servers.set_resources(&id, body).await?,
    }))
}

#[derive(Deserialize, utoipa::ToSchema, utoipa::IntoParams)]
#[serde(deny_unknown_fields)]
#[into_params(parameter_in = Query)]
pub(crate) struct LogsQuery {
    tail: Option<u32>,
}
#[derive(Deserialize, utoipa::ToSchema)]
#[serde(deny_unknown_fields)]
pub(crate) struct CommandRequest {
    line: String,
}

#[utoipa::path(post, path = "/api/v1/servers", operation_id = "servers_create", tag = "servers", request_body = CreateServer, responses((status = 201, description = "Success", body = ServerResponse), (status = "default", description = "Request rejected", body = crate::error::Problem, content_type = "application/problem+json"))) ]
pub(crate) async fn create(
    State(state): State<AppState>,
    ApiJson(body): ApiJson<CreateServer>,
) -> Result<Response, ApiError> {
    let server = state.servers.create(body).await?;
    let location = format!("/api/v1/servers/{}", server.server.id);
    let mut response = (StatusCode::CREATED, Json(ServerResponse { server })).into_response();
    response.headers_mut().insert(
        "location",
        HeaderValue::from_str(&location).map_err(ApiError::internal)?,
    );
    Ok(response)
}
#[utoipa::path(get, path = "/api/v1/servers", operation_id = "servers_list", tag = "servers", responses((status = 200, description = "Success", body = Items<chunkyard_core::server::ServerView>), (status = "default", description = "Request rejected", body = crate::error::Problem, content_type = "application/problem+json"))) ]
pub(crate) async fn list(
    State(state): State<AppState>,
) -> Result<Json<Items<chunkyard_core::server::ServerView>>, ApiError> {
    Ok(Json(Items {
        items: state.servers.list().await?,
    }))
}
#[utoipa::path(get, path = "/api/v1/servers/{id}", operation_id = "servers_get", tag = "servers", params(("id" = String, Path)), responses((status = 200, description = "Success", body = chunkyard_core::server::ServerView), (status = "default", description = "Request rejected", body = crate::error::Problem, content_type = "application/problem+json"))) ]
pub(crate) async fn get(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<chunkyard_core::server::ServerView>, ApiError> {
    Ok(Json(state.servers.get(&id).await?))
}

#[utoipa::path(get, path = "/api/v1/servers/{id}/network", operation_id = "servers_network", tag = "servers", params(("id" = String, Path)), responses((status = 200, description = "Success", body = chunkyard_core::server::NetworkSettings), (status = "default", description = "Request rejected", body = crate::error::Problem, content_type = "application/problem+json"))) ]
pub(crate) async fn network(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<chunkyard_core::server::NetworkSettings>, ApiError> {
    Ok(Json(state.servers.network(&id).await?))
}

#[utoipa::path(patch, path = "/api/v1/servers/{id}/network", operation_id = "servers_set_network", tag = "servers", params(("id" = String, Path)), request_body = chunkyard_core::server::NetworkUpdate, responses((status = 200, description = "Success", body = ServerResponse), (status = "default", description = "Request rejected", body = crate::error::Problem, content_type = "application/problem+json"))) ]
pub(crate) async fn set_network(
    State(state): State<AppState>,
    Path(id): Path<String>,
    ApiJson(body): ApiJson<chunkyard_core::server::NetworkUpdate>,
) -> Result<Json<ServerResponse>, ApiError> {
    Ok(Json(ServerResponse {
        server: state.servers.set_network(&id, body).await?,
    }))
}
#[utoipa::path(get, path = "/api/v1/servers/{id}/metrics", operation_id = "servers_metrics", tag = "servers", params(("id" = String, Path)), responses((status = 200, description = "Success", body = chunkyard_core::server::ServerMetrics), (status = "default", description = "Request rejected", body = crate::error::Problem, content_type = "application/problem+json"))) ]
pub(crate) async fn metrics(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<chunkyard_core::server::ServerMetrics>, ApiError> {
    Ok(Json(state.servers.metrics(&id).await?))
}
#[utoipa::path(get, path = "/api/v1/system/isolation", operation_id = "servers_isolation", tag = "servers", responses((status = 200, description = "Success", body = Isolation), (status = "default", description = "Request rejected", body = crate::error::Problem, content_type = "application/problem+json"))) ]
pub(crate) async fn isolation(State(state): State<AppState>) -> Json<Isolation> {
    Json(Isolation {
        docker: state.servers.runtime_info().await,
    })
}
#[utoipa::path(get, path = "/api/v1/servers/{id}/console", operation_id = "servers_logs", tag = "servers", params(("id" = String, Path), LogsQuery), responses((status = 200, description = "Success", body = Items<chunkyard_core::server::ConsoleLine>), (status = "default", description = "Request rejected", body = crate::error::Problem, content_type = "application/problem+json"))) ]
pub(crate) async fn logs(
    State(state): State<AppState>,
    Path(id): Path<String>,
    query: Result<Query<LogsQuery>, axum::extract::rejection::QueryRejection>,
) -> Result<Json<Items<chunkyard_core::server::ConsoleLine>>, ApiError> {
    let Query(query) = query.map_err(|_| {
        ApiError::new(
            StatusCode::BAD_REQUEST,
            "validation",
            "Invalid console query.",
        )
    })?;
    Ok(Json(Items {
        items: state.servers.logs(&id, query.tail.unwrap_or(200)).await?,
    }))
}
#[utoipa::path(post, path = "/api/v1/servers/{id}/console/commands", operation_id = "servers_command", tag = "servers", params(("id" = String, Path)), request_body = CommandRequest, responses((status = 204, description = "Success"), (status = "default", description = "Request rejected", body = crate::error::Problem, content_type = "application/problem+json"))) ]
pub(crate) async fn command(
    State(state): State<AppState>,
    Path(id): Path<String>,
    ApiJson(body): ApiJson<CommandRequest>,
) -> Result<StatusCode, ApiError> {
    state.servers.command(&id, &body.line).await?;
    Ok(StatusCode::NO_CONTENT)
}
#[derive(Deserialize, utoipa::ToSchema)]
#[serde(deny_unknown_fields)]
pub(crate) struct EulaRequest {
    accepted: bool,
}
#[utoipa::path(post, path = "/api/v1/servers/{id}/eula", operation_id = "servers_eula", tag = "servers", params(("id" = String, Path)), request_body = EulaRequest, responses((status = 200, description = "Success", body = ServerResponse), (status = "default", description = "Request rejected", body = crate::error::Problem, content_type = "application/problem+json"))) ]
pub(crate) async fn eula(
    State(state): State<AppState>,
    Path(id): Path<String>,
    ApiJson(body): ApiJson<EulaRequest>,
) -> Result<Json<ServerResponse>, ApiError> {
    Ok(Json(ServerResponse {
        server: state.servers.set_eula(&id, body.accepted).await?,
    }))
}
#[derive(Clone)]
pub(crate) enum Action {
    Delete { delete_files: bool },
    Install(chunkyard_core::software::InstallOptions),
    Start,
    Stop,
    Restart,
    Kill,
}
pub(crate) async fn action(
    state: AppState,
    actor: Actor,
    id: String,
    action: Action,
) -> Result<(StatusCode, Json<JobResponse>), ApiError> {
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
    let progress = chunkyard_core::progress::ProgressReporter::default();
    let worker_progress = progress.clone();
    let job_server_id = id.clone();
    let job = state
        .jobs
        .submit_progress_for_server(
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
                    Action::Install(options) => {
                        servers
                            .install_with_progress(&id, options, worker_progress)
                            .await
                    }
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
            progress,
        )
        .await?;
    Ok((StatusCode::ACCEPTED, Json(JobResponse { job })))
}
#[utoipa::path(post, path = "/api/v1/servers/{id}/start", operation_id = "servers_start", tag = "servers", params(("id" = String, Path)), responses((status = 202, description = "Success", body = JobResponse), (status = "default", description = "Request rejected", body = crate::error::Problem, content_type = "application/problem+json"))) ]
pub(crate) async fn start(
    State(state): State<AppState>,
    Extension(actor): Extension<Actor>,
    Path(id): Path<String>,
) -> Result<(StatusCode, Json<JobResponse>), ApiError> {
    action(state, actor, id, Action::Start).await
}
#[utoipa::path(post, path = "/api/v1/servers/{id}/stop", operation_id = "servers_stop", tag = "servers", params(("id" = String, Path)), responses((status = 202, description = "Success", body = JobResponse), (status = "default", description = "Request rejected", body = crate::error::Problem, content_type = "application/problem+json"))) ]
pub(crate) async fn stop(
    State(state): State<AppState>,
    Extension(actor): Extension<Actor>,
    Path(id): Path<String>,
) -> Result<(StatusCode, Json<JobResponse>), ApiError> {
    action(state, actor, id, Action::Stop).await
}
#[utoipa::path(post, path = "/api/v1/servers/{id}/restart", operation_id = "servers_restart", tag = "servers", params(("id" = String, Path)), responses((status = 202, description = "Success", body = JobResponse), (status = "default", description = "Request rejected", body = crate::error::Problem, content_type = "application/problem+json"))) ]
pub(crate) async fn restart(
    State(state): State<AppState>,
    Extension(actor): Extension<Actor>,
    Path(id): Path<String>,
) -> Result<(StatusCode, Json<JobResponse>), ApiError> {
    action(state, actor, id, Action::Restart).await
}
#[utoipa::path(post, path = "/api/v1/servers/{id}/kill", operation_id = "servers_kill", tag = "servers", params(("id" = String, Path)), responses((status = 202, description = "Success", body = JobResponse), (status = "default", description = "Request rejected", body = crate::error::Problem, content_type = "application/problem+json"))) ]
pub(crate) async fn kill(
    State(state): State<AppState>,
    Extension(actor): Extension<Actor>,
    Path(id): Path<String>,
) -> Result<(StatusCode, Json<JobResponse>), ApiError> {
    action(state, actor, id, Action::Kill).await
}

#[utoipa::path(post, path = "/api/v1/servers/{id}/install", operation_id = "servers_install", tag = "servers", params(("id" = String, Path)), request_body = Option<chunkyard_core::software::InstallOptions>, responses((status = 202, description = "Success", body = JobResponse), (status = "default", description = "Request rejected", body = crate::error::Problem, content_type = "application/problem+json"))) ]
pub(crate) async fn install(
    State(state): State<AppState>,
    Extension(actor): Extension<Actor>,
    Path(id): Path<String>,
    body: axum::body::Bytes,
) -> Result<(StatusCode, Json<JobResponse>), ApiError> {
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

fn job_failure(error: chunkyard_core::server::ServerError) -> JobFailure {
    JobFailure {
        code: error.code().into(),
        detail: error.public_detail(),
    }
}
#[derive(Deserialize, utoipa::ToSchema, utoipa::IntoParams)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[into_params(parameter_in = Query)]
pub(crate) struct DeleteQuery {
    #[serde(default)]
    delete_files: bool,
}
#[utoipa::path(delete, path = "/api/v1/servers/{id}", operation_id = "servers_delete", tag = "servers", params(("id" = String, Path), DeleteQuery), responses((status = 202, description = "Success", body = JobResponse), (status = "default", description = "Request rejected", body = crate::error::Problem, content_type = "application/problem+json"))) ]
pub(crate) async fn delete(
    State(state): State<AppState>,
    Extension(actor): Extension<Actor>,
    Path(id): Path<String>,
    query: Result<Query<DeleteQuery>, axum::extract::rejection::QueryRejection>,
) -> Result<(StatusCode, Json<JobResponse>), ApiError> {
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
