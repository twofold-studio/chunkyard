use crate::ServerManager;
use mcm_core::{server::*, software::*};
pub(crate) fn detected(server: &Server) -> LaunchProfile {
    let launch = server.launch.as_ref();
    let options = launch.and_then(|l| l.profile.as_ref());
    LaunchProfile {
        mode: options.map(|o| o.mode).unwrap_or(LaunchMode::Jar),
        path: launch
            .map(|l| l.path.clone())
            .unwrap_or_else(|| server.jar.clone()),
        java_major: launch.map(|l| l.java_major).unwrap_or(21),
        jvm_args: options.map(|o| o.jvm_args.clone()).unwrap_or_default(),
        args: options.map(|o| o.args.clone()).unwrap_or_default(),
    }
}
pub(crate) fn current(server: &Server) -> LaunchProfile {
    server
        .launch_override
        .clone()
        .unwrap_or_else(|| detected(server))
}
pub(crate) fn command(server: &Server) -> (String, Vec<String>) {
    let profile = current(server);
    if profile.mode == LaunchMode::Script {
        let mut args = vec![profile.path];
        args.extend(profile.args);
        return ("/bin/bash".into(), args);
    }
    let mut args = profile.jvm_args;
    args.extend([
        format!("-Xms{}M", server.memory_min_mb),
        format!("-Xmx{}M", server.memory_max_mb),
    ]);
    if profile.mode == LaunchMode::Jar {
        args.extend(["-jar".into(), profile.path]);
    } else {
        args.push(format!("@{}", profile.path));
    }
    args.extend(profile.args);
    args.extend(["nogui".into(), "--port".into(), "25565".into()]);
    ("java".into(), args)
}
impl ServerManager {
    pub(crate) async fn read_launch(&self, id: &str) -> Result<LaunchSettings, ServerError> {
        let server = self.record(id).await?;
        Ok(LaunchSettings {
            detected: detected(&server),
            current: current(&server),
            overridden: server.launch_override.is_some(),
            docker_image: server.docker_image,
            auto_java: server.auto_java,
        })
    }
    pub(crate) async fn update_launch(
        &self,
        id: &str,
        request: LaunchUpdate,
    ) -> Result<ServerView, ServerError> {
        if let Some(profile) = &request.profile {
            profile.validate()?;
        }
        if let Some(Some(image)) = &request.docker_image {
            crate::validation::image_name(image)?;
        }
        let server = self.record(id).await?;
        let lock = self.lock(&server.id)?;
        let _guard = lock.try_lock().map_err(|_| ServerError::Busy)?;
        let mut server = self.record(id).await?;
        if server.software.is_some() && server.launch.is_none() {
            return Err(ServerError::NotInstalled);
        }
        if self.runtime.status(&server).await?.state != ServerState::Stopped {
            return Err(ServerError::AlreadyRunning);
        }
        let profile = request
            .profile
            .as_ref()
            .cloned()
            .unwrap_or_else(|| detected(&server));
        let (image, auto) = match request.docker_image {
            Some(Some(image)) => (image, false),
            Some(None) => (format!("eclipse-temurin:{}-jre", profile.java_major), true),
            None if server.auto_java => {
                (format!("eclipse-temurin:{}-jre", profile.java_major), true)
            }
            None => (server.docker_image.clone(), false),
        };
        self.runtime.remove(&server).await?;
        self.repo
            .set_launch(&server.id, request.profile.as_ref(), &image, auto)
            .await?;
        server.launch_override = request.profile;
        server.docker_image = image;
        server.auto_java = auto;
        self.view(server).await
    }
}
