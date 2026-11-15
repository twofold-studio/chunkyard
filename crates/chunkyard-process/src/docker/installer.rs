use super::{DockerRuntime, docker_error};
use bollard::{
    Docker,
    query_parameters::{
        CreateContainerOptionsBuilder, LogsOptionsBuilder, RemoveContainerOptionsBuilder,
    },
};
use chunkyard_core::{
    server::*,
    software::{InstallerCommand, SoftwareError},
};
use futures_util::{StreamExt, TryStreamExt};
use std::{path::PathBuf, sync::Arc, time::Duration};

struct Cleanup {
    client: Docker,
    name: String,
    instance: String,
    server: String,
    lease: Option<Arc<dyn Send + Sync>>,
    tasks: tokio_util::task::TaskTracker,
}
impl Drop for Cleanup {
    fn drop(&mut self) {
        let Some(lease) = self.lease.take() else {
            return;
        };
        let (client, name, instance, server) = (
            self.client.clone(),
            self.name.clone(),
            self.instance.clone(),
            self.server.clone(),
        );
        self.tasks.spawn(async move {
            let _lease = lease;
            let _ = remove_owned(&client, &name, &instance, &server).await;
        });
    }
}
pub(super) async fn remove_owned(
    client: &Docker,
    name: &str,
    instance: &str,
    server: &str,
) -> Result<(), ServerError> {
    tokio::time::timeout(Duration::from_secs(15), async {
        let container = match client.inspect_container(name, None).await {
            Ok(c) => c,
            Err(bollard::errors::Error::DockerResponseServerError {
                status_code: 404, ..
            }) => return Ok(()),
            Err(e) => return Err(docker_error(e)),
        };
        let labels = container
            .config
            .and_then(|c| c.labels)
            .ok_or(ServerError::ContainerConflict)?;
        if labels.get("mcm.managed").map(String::as_str) != Some("true")
            || labels.get("mcm.instance_id").map(String::as_str) != Some(instance)
            || labels.get("mcm.server_id").map(String::as_str) != Some(server)
            || labels.get("mcm.installer").map(String::as_str) != Some("true")
        {
            return Err(ServerError::ContainerConflict);
        }
        client
            .remove_container(
                &container.id.ok_or(ServerError::ContainerConflict)?,
                Some(
                    RemoveContainerOptionsBuilder::default()
                        .force(true)
                        .v(false)
                        .build(),
                ),
            )
            .await
            .map_err(docker_error)
    })
    .await
    .map_err(|_| ServerError::DockerUnavailable)?
}
impl DockerRuntime {
    pub async fn recover_installers(&self) -> Result<(), ServerError> {
        use bollard::query_parameters::ListContainersOptionsBuilder;
        let filters = std::collections::HashMap::from([(
            "label",
            vec![
                format!("mcm.instance_id={}", self.instance),
                "mcm.installer=true".into(),
                "mcm.managed=true".into(),
            ],
        )]);
        let client = self.ready().await?;
        let containers = tokio::time::timeout(
            Duration::from_secs(10),
            client.list_containers(Some(
                ListContainersOptionsBuilder::default()
                    .all(true)
                    .limit(128)
                    .filters(&filters)
                    .build(),
            )),
        )
        .await
        .map_err(|_| ServerError::DockerUnavailable)?
        .map_err(docker_error)?;
        for container in containers {
            let labels = container.labels.ok_or(ServerError::ContainerConflict)?;
            let server = labels
                .get("mcm.server_id")
                .ok_or(ServerError::ContainerConflict)?;
            uuid::Uuid::parse_str(server).map_err(|_| ServerError::ContainerConflict)?;
            remove_owned(
                client,
                &container.id.ok_or(ServerError::ContainerConflict)?,
                &self.instance,
                server,
            )
            .await?;
        }
        Ok(())
    }
    pub(super) async fn install_loader(
        &self,
        server: &Server,
        directory: PathBuf,
        command: InstallerCommand,
        lease: Arc<dyn Send + Sync>,
    ) -> Result<(), ServerError> {
        let client = self.ready().await?.clone();
        let name = format!("{}-installer", self.name(server));
        // Recover an installer left by a killed manager, checking ownership before removal.
        remove_owned(&client, &name, &self.instance, &server.id).await?;
        let source = if let Some(host) = &self.config.host_data_dir {
            let stage = directory
                .parent()
                .and_then(|p| p.file_name())
                .and_then(|s| s.to_str())
                .filter(|s| s.starts_with(".chunkyard-software-"))
                .ok_or(ServerError::Filesystem)?;
            if directory.file_name().and_then(|s| s.to_str()) != Some("pack")
                || directory
                    .parent()
                    .and_then(|p| p.parent())
                    .and_then(|p| p.file_name())
                    .and_then(|s| s.to_str())
                    != Some(server.id.as_str())
            {
                return Err(ServerError::Filesystem);
            }
            host.join("servers")
                .join(&server.id)
                .join(stage)
                .join("pack")
        } else {
            directory.clone()
        };
        let image = tokio::time::timeout(
            Duration::from_secs(600),
            self.ensure_image(&format!("eclipse-temurin:{}-jdk", command.java_major)),
        )
        .await
        .map_err(|_| SoftwareError::InstallFailed)??;
        let mut body = self.body(server, directory, image, self.container_user().await?)?;
        body.entrypoint = Some(vec!["java".into()]);
        let mut args = vec![
            format!("-Xmx{}M", server.memory_max_mb.min(2048)),
            "-Duser.home=/tmp".into(),
            "-Djava.io.tmpdir=/tmp".into(),
            "-jar".into(),
            command.path,
        ];
        args.extend(command.args);
        body.cmd = Some(args);
        body.env = Some(vec!["HOME=/tmp".into()]);
        body.exposed_ports = None;
        body.open_stdin = Some(false);
        body.attach_stdin = Some(false);
        if let Some(labels) = body.labels.as_mut() {
            labels.insert("mcm.installer".into(), "true".into());
        }
        if let Some(host) = body.host_config.as_mut() {
            host.port_bindings = None;
            if let Some(mount) = host.mounts.as_mut().and_then(|m| m.first_mut()) {
                mount.source = Some(source.to_str().ok_or(ServerError::Filesystem)?.into());
            }
        }
        let mut cleanup = Cleanup {
            client: client.clone(),
            name: name.clone(),
            instance: self.instance.clone(),
            server: server.id.clone(),
            lease: Some(lease),
            tasks: self.installer_tasks.clone(),
        };
        client
            .create_container(
                Some(CreateContainerOptionsBuilder::default().name(&name).build()),
                body,
            )
            .await
            .map_err(docker_error)?;
        client
            .start_container(&name, None)
            .await
            .map_err(docker_error)?;
        let result = tokio::time::timeout(Duration::from_secs(900), async {
            let mut wait = client.wait_container(&name, None);
            let outcome = wait
                .try_next()
                .await
                .map_err(docker_error)?
                .ok_or(ServerError::Docker)?;
            if outcome.status_code != 0 {
                return Err(ServerError::Software(SoftwareError::InstallFailed));
            }
            Ok(())
        })
        .await
        .map_err(|_| ServerError::Software(SoftwareError::InstallFailed))?;
        if result.is_err() {
            let mut logs = client.logs(
                &name,
                Some(
                    LogsOptionsBuilder::default()
                        .stdout(true)
                        .stderr(true)
                        .tail("50")
                        .build(),
                ),
            );
            let mut text = String::new();
            while let Some(Ok(line)) = logs.next().await {
                if text.len() + line.as_ref().len() > 8192 {
                    break;
                }
                text.push_str(&line.to_string());
            }
            tracing::warn!(server_id=%server.id,diagnostics=%text,"isolated loader installer failed");
        }
        remove_owned(&client, &name, &self.instance, &server.id).await?;
        cleanup.lease = None;
        result
    }
}
