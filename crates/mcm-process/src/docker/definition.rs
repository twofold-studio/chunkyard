use super::DockerRuntime;
use bollard::models::{
    ContainerCreateBody, HostConfig, HostConfigLogConfig, Mount, MountType, PortBinding,
};
use mcm_core::server::{Server, ServerError};
use std::{collections::HashMap, path::PathBuf};
impl DockerRuntime {
    pub(crate) fn body(
        &self,
        server: &Server,
        directory: PathBuf,
        image: String,
        user: String,
    ) -> Result<ContainerCreateBody, ServerError> {
        let directory = self
            .config
            .host_data_dir
            .as_ref()
            .map(|root| root.join("servers").join(&server.id))
            .unwrap_or(directory);
        let source = directory
            .to_str()
            .ok_or(ServerError::Invalid(
                "Docker bind path must be valid Unicode",
            ))?
            .to_owned();
        let limit = (i64::from(server.memory_max_mb)
            + i64::from(server.memory_max_mb / 4).max(256))
            * 1024
            * 1024;
        let (entrypoint, cmd) = crate::launch::command(server);
        Ok(ContainerCreateBody {
            image: Some(image),
            working_dir: Some("/data".into()),
            user: Some(user),
            entrypoint: Some(vec![entrypoint]),
            cmd: Some(cmd),
            open_stdin: Some(true),
            stdin_once: Some(false),
            attach_stdin: Some(true),
            attach_stdout: Some(true),
            attach_stderr: Some(true),
            tty: Some(false),
            exposed_ports: Some(vec!["25565/tcp".into()]),
            labels: Some(HashMap::from([
                ("mcm.managed".into(), "true".into()),
                ("mcm.instance_id".into(), self.instance.clone()),
                ("mcm.server_id".into(), server.id.clone()),
                ("mcm.version".into(), env!("CARGO_PKG_VERSION").into()),
            ])),
            host_config: Some(HostConfig {
                mounts: Some(vec![Mount {
                    target: Some("/data".into()),
                    source: Some(source),
                    typ: Some(MountType::BIND),
                    read_only: Some(false),
                    ..Default::default()
                }]),
                network_mode: Some("bridge".into()),
                port_bindings: Some(HashMap::from([(
                    "25565/tcp".into(),
                    Some(vec![PortBinding {
                        host_ip: Some(
                            server
                                .publish_ip
                                .unwrap_or(self.config.publish_ip)
                                .to_string(),
                        ),
                        host_port: Some(server.port.to_string()),
                    }]),
                )])),
                readonly_rootfs: Some(true),
                cap_drop: Some(vec!["ALL".into()]),
                security_opt: Some(vec!["no-new-privileges:true".into()]),
                init: Some(true),
                tmpfs: Some(HashMap::from([(
                    "/tmp".into(),
                    "rw,nosuid,nodev,size=256m,mode=1777".into(),
                )])),
                memory: Some(limit),
                memory_swap: Some(limit),
                nano_cpus: Some((server.cpus * 1_000_000_000.0) as i64),
                pids_limit: Some(512),
                log_config: Some(HostConfigLogConfig {
                    typ: Some("json-file".into()),
                    config: Some(HashMap::from([
                        ("max-size".into(), "10m".into()),
                        ("max-file".into(), "3".into()),
                    ])),
                }),
                ..Default::default()
            }),
            ..Default::default()
        })
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn modern_loader_and_script_profiles_build_argument_vectors_without_host_shells() {
        use mcm_core::software::*;
        let mut s = server();
        s.launch_override = Some(LaunchProfile {
            mode: LaunchMode::Args,
            path: "libraries/forge/unix_args.txt".into(),
            java_major: 17,
            jvm_args: vec!["-Dexample=true".into()],
            args: vec!["--world".into(), "a world with spaces".into()],
        });
        let (entry, args) = crate::launch::command(&s);
        assert_eq!(entry, "java");
        assert!(args.contains(&"@libraries/forge/unix_args.txt".into()));
        assert!(args.contains(&"a world with spaces".into()));
        assert_eq!(args.last().map(String::as_str), Some("25565"));
        if let Some(p) = s.launch_override.as_mut() {
            p.mode = LaunchMode::Script;
            p.path = "start.sh".into();
            p.args = vec!["$(never-expanded-by-manager)".into()];
        }
        let (entry, args) = crate::launch::command(&s);
        assert_eq!(entry, "/bin/bash");
        assert_eq!(args, vec!["start.sh", "$(never-expanded-by-manager)"]);
    }
    fn server() -> Server {
        Server {
            launch_override: None,
            id: "test-server".into(),
            name: "Test".into(),
            runtime: "docker".into(),
            jar: "a directory/server.jar".into(),
            docker_image: "test:21".into(),
            port: 25577,
            memory_min_mb: 128,
            memory_max_mb: 1024,
            cpus: 1.5,
            accept_eula: true,
            software: None,
            launch: None,
            auto_java: false,
            publish_ip: None,
        }
    }
    #[test]
    fn container_is_hardened_and_publishes_only_the_game_port()
    -> Result<(), Box<dyn std::error::Error>> {
        let runtime = DockerRuntime::new(
            crate::DockerConfig {
                enabled: false,
                ..Default::default()
            },
            "instance".into(),
        );
        let body = runtime.body(
            &server(),
            "/managed/server".into(),
            "sha256:resolved".into(),
            "1000:1000".into(),
        )?;
        let value = serde_json::to_value(body)?;
        let host = &value["HostConfig"];
        assert_eq!(host["ReadonlyRootfs"], true);
        assert_eq!(host["CapDrop"], serde_json::json!(["ALL"]));
        assert_eq!(
            host["SecurityOpt"],
            serde_json::json!(["no-new-privileges:true"])
        );
        assert_eq!(host["Memory"], host["MemorySwap"]);
        assert_eq!(host["NanoCpus"], 1_500_000_000_i64);
        assert_eq!(host["Mounts"].as_array().map(Vec::len), Some(1));
        assert_eq!(
            host["PortBindings"].as_object().map(serde_json::Map::len),
            Some(1)
        );
        assert_eq!(host["PortBindings"]["25565/tcp"][0]["HostIp"], "0.0.0.0");
        assert_eq!(value["Entrypoint"], serde_json::json!(["java"]));
        assert_eq!(value["Cmd"][3], "a directory/server.jar");
        Ok(())
    }
    #[test]
    fn managed_jar_launch_uses_the_persisted_artifact() -> Result<(), Box<dyn std::error::Error>> {
        let runtime = DockerRuntime::new(
            crate::DockerConfig {
                enabled: false,
                ..Default::default()
            },
            "instance".into(),
        );
        let mut server = server();
        server.launch = Some(mcm_core::software::Launch {
            profile: None,
            loader: None,
            path: ".chunkyard-software-test/server.jar".into(),
            version: "1.21.4".into(),
            build: Some("232".into()),
            java_major: 21,
            checksum: "verified".into(),
        });
        let body = serde_json::to_value(runtime.body(
            &server,
            "/managed/server".into(),
            "sha256:resolved".into(),
            "1000:1000".into(),
        )?)?;
        assert_eq!(body["Cmd"][3], ".chunkyard-software-test/server.jar");
        assert_eq!(body["Image"], "sha256:resolved");
        Ok(())
    }
    #[test]
    fn explicit_host_data_directory_translates_only_the_managed_server_path()
    -> Result<(), Box<dyn std::error::Error>> {
        let runtime = DockerRuntime::new(
            crate::DockerConfig {
                enabled: false,
                host_data_dir: Some("/host/data".into()),
                ..Default::default()
            },
            "instance".into(),
        );
        let body = serde_json::to_value(runtime.body(
            &server(),
            "/data/servers/test-server".into(),
            "image".into(),
            "1000:1000".into(),
        )?)?;
        assert_eq!(
            body["HostConfig"]["Mounts"][0]["Source"],
            std::path::Path::new("/host/data")
                .join("servers")
                .join("test-server")
                .to_string_lossy()
                .as_ref()
        );
        Ok(())
    }
}

#[cfg(test)]
mod disabled_tests {
    use super::*;
    use mcm_core::server::ServerRuntime;
    #[tokio::test]
    async fn disabled_runtime_reports_unavailable_without_connecting() {
        let runtime = DockerRuntime::new(
            crate::DockerConfig {
                enabled: false,
                ..Default::default()
            },
            "instance".into(),
        );
        assert!(!runtime.info().await.available);
    }
}
