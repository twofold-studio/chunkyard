use super::{schema::tools, *};
use crate::servers::{self, Action};
fn argument<'a>(args: &'a Value, key: &str) -> Result<&'a str, ApiError> {
    args.get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| invalid("A required string argument is missing."))
}
fn invalid(detail: &'static str) -> ApiError {
    ApiError::new(StatusCode::UNPROCESSABLE_ENTITY, "validation", detail)
}
pub(super) async fn call(
    state: &AppState,
    actor: Actor,
    name: &str,
    args: Value,
) -> Result<Value, ApiError> {
    // Enforce the advertised argument shape before invoking any service.
    let definition = tools()
        .iter()
        .find(|tool| tool["name"] == name)
        .ok_or_else(|| invalid("Unknown tool."))?;
    let schema = &definition["inputSchema"];
    if args.as_object().is_some_and(|args| {
        args.keys()
            .any(|key| schema["properties"].get(key).is_none())
    }) {
        return Err(invalid("Unknown tool argument."));
    }
    if definition["annotations"]["readOnlyHint"] == false
        && args.get("confirm") != Some(&Value::Bool(true))
    {
        return Err(invalid("confirm: true is required for a mutation."));
    }
    if name == "list_servers" {
        return Ok(json!({"items":state.servers.list().await?}));
    }
    if name == "create_server" {
        let mut config = args
            .get("config")
            .and_then(Value::as_object)
            .cloned()
            .ok_or_else(|| invalid("A server config object is required."))?;
        let allowed = [
            "name",
            "software",
            "memoryMinMb",
            "memoryMaxMb",
            "cpus",
            "port",
        ];
        if config.keys().any(|key| !allowed.contains(&key.as_str())) {
            return Err(invalid(
                "Unsupported create config field; use the REST API for advanced settings.",
            ));
        }
        config.insert("acceptEula".into(), Value::Bool(false));
        let request = serde_json::from_value(Value::Object(config))
            .map_err(|_| invalid("Invalid CreateServer config."))?;
        return Ok(json!({"server":state.servers.create(request).await?}));
    }
    if name == "list_backups" {
        return Ok(json!({"items":state.exports.list().await?}));
    }
    if name == "get_job" {
        let id = argument(&args, "jobId")?;
        uuid::Uuid::parse_str(id).map_err(|_| invalid("Invalid job ID."))?;
        return Ok(json!({"job":state.jobs.get(id).await?}));
    }
    let id = argument(&args, "serverId")?;
    uuid::Uuid::parse_str(id).map_err(|_| invalid("Invalid server ID."))?;
    Ok(match name {
        "get_server" => json!({"server":state.servers.get(id).await?}),
        "get_metrics" => json!({"sample":state.servers.metrics(id).await?}),
        "get_console" => json!({"items":state.servers.logs(id,200).await?}),
        "get_properties" => json!({"properties":state.properties.properties(id).await?}),
        "list_files" => json!({"files":state.files.list(id,argument(&args,"path")?.into()).await?}),
        "read_file" => {
            json!({"file":state.files.content(id,argument(&args,"path")?.into()).await?})
        }
        "write_properties" => {
            let request = chunkyard_core::properties::PropertiesWrite {
                content: argument(&args, "content")?.into(),
                etag: argument(&args, "etag")?.into(),
            };
            let properties = state.properties.save_properties(id, request).await?;
            json!({ "properties": properties })
        }
        "send_command" => {
            state.servers.command(id, argument(&args, "line")?).await?;
            json!({"sent":true})
        }
        "start_server" | "stop_server" | "restart_server" | "install_server" => {
            let action = match name {
                "start_server" => Action::Start,
                "stop_server" => Action::Stop,
                "restart_server" => Action::Restart,
                _ => Action::Install(Default::default()),
            };
            let (_, Json(result)) =
                servers::action(state.clone(), actor, id.into(), action).await?;
            result
        }
        _ => return Err(invalid("Unknown tool.")),
    })
}
