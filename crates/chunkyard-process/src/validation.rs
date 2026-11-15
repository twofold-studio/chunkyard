use chunkyard_core::server::{CreateServer, ServerError};
use std::path::{Component, Path};

pub(crate) fn validate(request: &CreateServer) -> Result<(), ServerError> {
    if request.runtime != "docker" {
        return Err(ServerError::Invalid(
            "only the docker runtime is available in this increment",
        ));
    }
    if request.name.trim().is_empty()
        || request.name.chars().count() > 80
        || request.name.chars().any(char::is_control)
    {
        return Err(ServerError::Invalid("name must be 1–80 characters"));
    }
    if request.port == Some(0) {
        return Err(ServerError::Invalid("port must be between 1 and 65535"));
    }
    resources(request.memory_min_mb, request.memory_max_mb, request.cpus)?;
    jar_path(&request.jar)?;
    if let Some(image) = &request.docker_image {
        image_name(image)?;
    }
    Ok(())
}
pub(crate) fn resources(min: u32, max: u32, cpus: f64) -> Result<(), ServerError> {
    if min < 128 || min > max || max > 262144 {
        return Err(ServerError::Invalid(
            "memory must satisfy 128 <= min <= max <= 262144 MiB",
        ));
    }
    if !cpus.is_finite() || !(0.1..=256.0).contains(&cpus) {
        return Err(ServerError::Invalid("cpus must be between 0.1 and 256"));
    }
    Ok(())
}
pub(crate) fn jar_path(value: &str) -> Result<(), ServerError> {
    if value.len() > 512
        || !value.ends_with(".jar")
        || value.contains(['\\', ':'])
        || Path::new(value)
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
        || value.chars().any(char::is_control)
    {
        return Err(ServerError::Invalid(
            "jar must be a relative .jar path inside the server directory",
        ));
    }
    Ok(())
}
pub(crate) fn image_name(value: &str) -> Result<(), ServerError> {
    if value.is_empty()
        || value.len() > 255
        || value.starts_with('-')
        || !value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"/_.:@-".contains(&b))
    {
        return Err(ServerError::Invalid(
            "dockerImage must be a valid image name or digest",
        ));
    }
    Ok(())
}
