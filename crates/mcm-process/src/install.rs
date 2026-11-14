//! Stage complete modpacks, run only the loader installer in Docker, then publish
//! new top-level entries while retaining the instance lock through cancellation.
use crate::ServerManager;
use mcm_core::{server::*, software::*};
use sha2::{Digest, Sha256};
use std::{
    path::{Path, PathBuf},
    sync::Arc,
};

struct InstallLease {
    _guard: tokio::sync::OwnedMutexGuard<()>,
    staging: tempfile::TempDir,
    _token: tokio_util::task::task_tracker::TaskTrackerToken,
}
struct Publication {
    paths: Vec<PathBuf>,
    committed: bool,
    lease: Arc<InstallLease>,
}
impl Drop for Publication {
    fn drop(&mut self) {
        if self.committed {
            return;
        }
        let paths = std::mem::take(&mut self.paths);
        let lease = self.lease.clone();
        tokio::task::spawn_blocking(move || {
            let _lease = lease;
            for path in paths.into_iter().rev() {
                if path.is_dir() {
                    let _ = std::fs::remove_dir_all(path);
                } else {
                    let _ = std::fs::remove_file(path);
                }
            }
        });
    }
}
impl ServerManager {
    pub(crate) async fn install_pack(
        &self,
        id: &str,
        options: InstallOptions,
    ) -> Result<ServerView, ServerError> {
        if let Some(profile) = &options.launch {
            profile.validate()?;
        }
        for value in [&options.minecraft_version, &options.loader_version]
            .into_iter()
            .flatten()
        {
            component(value)?;
        }
        if options.java_major.is_some_and(|n| !(8..=99).contains(&n)) {
            return Err(SoftwareError::Invalid.into());
        }
        let server = self.record(id).await?;
        let guard = self
            .lock(&server.id)?
            .try_lock_owned()
            .map_err(|_| ServerError::Busy)?;
        let mut server = self.record(id).await?;
        if server.launch.is_some() {
            return Err(ServerError::AlreadyInstalled);
        }
        let status = self.runtime.status(&server).await?;
        if status.state != ServerState::Stopped {
            return Err(ServerError::AlreadyRunning);
        }
        if status.container_id.is_some() {
            return Err(ServerError::Invalid(
                "Install the pack before creating a game container.",
            ));
        }
        let directory = tokio::fs::canonicalize(self.root.join(&server.id))
            .await
            .map_err(|_| ServerError::Filesystem)?;
        let root = tokio::fs::canonicalize(&self.root)
            .await
            .map_err(|_| ServerError::Filesystem)?;
        if !directory.starts_with(root) {
            return Err(ServerError::Filesystem);
        }
        let staging = tempfile::Builder::new()
            .prefix(".chunkyard-software-")
            .tempdir_in(&directory)
            .map_err(|_| ServerError::Filesystem)?;
        let lease = Arc::new(InstallLease {
            _guard: guard,
            staging,
            _token: self.install_tasks.token(),
        });
        let software = server.software.as_ref().ok_or(SoftwareError::Invalid)?;
        let installers = self.installers.as_ref().ok_or(SoftwareError::Invalid)?;
        let mut prepared = installers
            .prepare_plan(software, lease.staging.path(), &options, lease.clone())
            .await?;
        if !prepared.instance_files {
            return Err(SoftwareError::PackUnsupported.into());
        }
        let pack = lease.staging.path().join("pack");
        if let Some(command) = prepared.installer.take() {
            self.runtime
                .run_installer(&server, pack.clone(), command, lease.clone())
                .await?;
        }
        // Legacy Forge installers differ in whether they retain the universal suffix.
        if !pack.join(&prepared.launch.path).is_file() && prepared.launch.path.ends_with(".jar") {
            let universal =
                prepared.launch.path.trim_end_matches(".jar").to_owned() + "-universal.jar";
            if pack.join(&universal).is_file() {
                prepared.launch.path = universal;
            }
        }
        let profile = LaunchProfile {
            mode: prepared
                .launch
                .profile
                .as_ref()
                .map(|p| p.mode)
                .unwrap_or(LaunchMode::Jar),
            path: prepared.launch.path.clone(),
            java_major: prepared.launch.java_major,
            jvm_args: prepared
                .launch
                .profile
                .as_ref()
                .map(|p| p.jvm_args.clone())
                .unwrap_or_default(),
            args: prepared
                .launch
                .profile
                .as_ref()
                .map(|p| p.args.clone())
                .unwrap_or_default(),
        };
        profile.validate()?;
        let metadata = tokio::fs::symlink_metadata(pack.join(&profile.path))
            .await
            .map_err(|_| SoftwareError::InstallFailed)?;
        if !metadata.is_file() {
            return Err(SoftwareError::InstallFailed.into());
        }
        let pack_properties = read_properties(&pack.join("server.properties")).await?;
        let owner = if let Some(repo) = &self.properties_repo {
            repo.state(&server.id)
                .await
                .map_err(|_| ServerError::Filesystem)?
                .desired
                .map(|v| v.content)
        } else {
            None
        };
        let owner = match owner {
            Some(content) => content,
            None => read_properties(&directory.join("server.properties"))
                .await?
                .unwrap_or_default(),
        };
        let publication_lease = lease.clone();
        let publish_root = directory.clone();
        let mut publication =
            tokio::task::spawn_blocking(move || publish(&pack, &publish_root, publication_lease))
                .await
                .map_err(|_| ServerError::Filesystem)??;
        if let Some(properties) = pack_properties
            && let Some(repo) = &self.properties_repo
        {
            // Last-value-wins Java properties retain the independently saved owner values.
            let content = format!(
                "{properties}\n{owner}\nserver-port=25565\nserver-ip=\nenable-rcon=false\n"
            );
            if content.len() > mcm_core::files::TEXT_LIMIT as usize {
                return Err(SoftwareError::Download.into());
            }
            let state = repo
                .state(&server.id)
                .await
                .map_err(|_| ServerError::Filesystem)?;
            repo.append(
                &server.id,
                &content,
                &format!("{:x}", Sha256::digest(content.as_bytes())),
                "import",
                state.desired.as_ref().map(|v| v.metadata.etag.as_str()),
                true,
            )
            .await
            .map_err(|_| ServerError::Filesystem)?;
        }
        if server.auto_java {
            server.docker_image = format!("eclipse-temurin:{}-jre", prepared.launch.java_major);
        }
        // SQLite can commit before cancellation delivers its acknowledgement. Once
        // persistence begins, retain published files even if the caller disappears;
        // a saved launch must never point at files removed by the rollback guard.
        publication.committed = true;
        self.repo
            .set_installation(&server.id, &prepared.launch, &server.docker_image)
            .await?;
        server.jar = prepared.launch.path.clone();
        server.launch = Some(prepared.launch);
        Ok(ServerView {
            server,
            directory,
            status,
        })
    }
}
async fn read_properties(path: &Path) -> Result<Option<String>, ServerError> {
    match tokio::fs::symlink_metadata(path).await {
        Ok(m) if !m.is_file() || m.len() > mcm_core::files::TEXT_LIMIT => {
            Err(ServerError::Filesystem)
        }
        Ok(_) => tokio::fs::read_to_string(path)
            .await
            .map(Some)
            .map_err(|_| ServerError::Filesystem),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(_) => Err(ServerError::Filesystem),
    }
}
fn publish(pack: &Path, root: &Path, lease: Arc<InstallLease>) -> Result<Publication, ServerError> {
    // A container can write links into its bind mount. Validate installer output
    // after it has stopped, before making that tree visible to the manager.
    let mut count = 0;
    let mut bytes = 0u64;
    validate_tree(pack, 0, &mut count, &mut bytes)?;
    let entries = std::fs::read_dir(pack)
        .map_err(|_| ServerError::Filesystem)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| ServerError::Filesystem)?;
    for entry in &entries {
        let name = entry.file_name();
        let name = name.to_str().ok_or(SoftwareError::PackUnsupported)?;
        if matches!(name, "eula.txt" | "server.properties") {
            continue;
        }
        if name.starts_with(".chunkyard-") || std::fs::symlink_metadata(root.join(name)).is_ok() {
            return Err(SoftwareError::FilesConflict.into());
        }
    }
    let mut publication = Publication {
        paths: Vec::new(),
        committed: false,
        lease,
    };
    for entry in entries {
        let name = entry.file_name();
        if name == "eula.txt" || name == "server.properties" {
            continue;
        }
        let target = root.join(name);
        std::fs::rename(entry.path(), &target).map_err(|_| ServerError::Filesystem)?;
        publication.paths.push(target);
    }
    Ok(publication)
}
fn validate_tree(
    root: &Path,
    depth: usize,
    count: &mut usize,
    bytes: &mut u64,
) -> Result<(), ServerError> {
    if depth > 32 {
        return Err(SoftwareError::Download.into());
    }
    for entry in std::fs::read_dir(root).map_err(|_| ServerError::Filesystem)? {
        *count += 1;
        if *count > 100_000 {
            return Err(SoftwareError::Download.into());
        }
        let entry = entry.map_err(|_| ServerError::Filesystem)?;
        let metadata = entry
            .path()
            .symlink_metadata()
            .map_err(|_| ServerError::Filesystem)?;
        if metadata.is_symlink() || (!metadata.is_file() && !metadata.is_dir()) {
            return Err(SoftwareError::Download.into());
        }
        if metadata.is_dir() {
            validate_tree(&entry.path(), depth + 1, count, bytes)?;
        } else {
            *bytes = bytes
                .checked_add(metadata.len())
                .ok_or(SoftwareError::Download)?;
            if *bytes > 8 * 1024 * 1024 * 1024 {
                return Err(SoftwareError::Download.into());
            }
        }
    }
    Ok(())
}
