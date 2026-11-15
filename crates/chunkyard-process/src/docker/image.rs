use super::{DockerRuntime, docker_error};
use bollard::{errors::Error, query_parameters::CreateImageOptionsBuilder};
use chunkyard_core::server::ServerError;
use futures_util::TryStreamExt;
impl DockerRuntime {
    pub(super) async fn ensure_image(&self, image: &str) -> Result<String, ServerError> {
        let client = self.client()?;
        match client.inspect_image(image).await {
            Ok(info) => return info.id.ok_or(ServerError::Docker),
            Err(Error::DockerResponseServerError {
                status_code: 404, ..
            }) => (),
            Err(error) => return Err(docker_error(error)),
        }
        let mut stream = client.create_image(
            Some(
                CreateImageOptionsBuilder::default()
                    .from_image(image)
                    .build(),
            ),
            None,
            None,
        );
        while let Some(item) = stream.try_next().await.map_err(docker_error)? {
            if item.error_detail.is_some() {
                return Err(ServerError::Docker);
            }
        }
        client
            .inspect_image(image)
            .await
            .map_err(docker_error)?
            .id
            .ok_or(ServerError::Docker)
    }
    pub(super) async fn container_user(&self) -> Result<String, ServerError> {
        if let Some(user) = &self.config.user {
            return Ok(user.clone());
        }
        let info = self.client()?.info().await.map_err(docker_error)?;
        let options = info.security_options.unwrap_or_default();
        if options.iter().any(|o| o.contains("name=userns")) {
            return Err(ServerError::Invalid(
                "userns-remap needs an explicit docker.user UID:GID mapping",
            ));
        }
        if options.iter().any(|o| o.contains("name=rootless")) {
            return Ok("0:0".into());
        }
        #[cfg(unix)]
        {
            Ok(format!(
                "{}:{}",
                rustix::process::geteuid().as_raw(),
                rustix::process::getegid().as_raw()
            ))
        }
        #[cfg(not(unix))]
        {
            Ok("1000:1000".into())
        }
    }
}
