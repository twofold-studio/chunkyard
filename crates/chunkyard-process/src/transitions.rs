//! A small durable journal for atomic directory publication and metadata acknowledgement.
use crate::ServerManager;
use chunkyard_core::server::{ArchiveReference, Server, ServerError, ServerRepo};
use serde::{Deserialize, Serialize};
use std::{
    path::{Path, PathBuf},
    sync::Arc,
};
use uuid::Uuid;

#[derive(Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum TransitionKind {
    Archive,
    Restore,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Transition {
    pub id: String,
    pub kind: TransitionKind,
    pub staging: String,
    pub previous: Option<ArchiveReference>,
    pub next: Option<ArchiveReference>,
}
impl Transition {
    pub(crate) fn journal(&self, root: &Path) -> PathBuf {
        journal_path(root, &self.id)
    }
    fn staging_files(&self, root: &Path) -> PathBuf {
        let path = root.join(&self.staging);
        match self.kind {
            TransitionKind::Archive => path,
            TransitionKind::Restore => path.join("files"),
        }
    }
    fn validate(&self) -> Result<(), ServerError> {
        if Uuid::parse_str(&self.id)
            .map(|id| id.to_string())
            .ok()
            .as_deref()
            != Some(&self.id)
            || self.previous == self.next
        {
            return Err(ServerError::Filesystem);
        }
        for reference in self.previous.iter().chain(self.next.iter()) {
            if Uuid::parse_str(&reference.export_id).is_err()
                || time::OffsetDateTime::parse(
                    &reference.archived_at,
                    &time::format_description::well_known::Rfc3339,
                )
                .is_err()
            {
                return Err(ServerError::Filesystem);
            }
        }
        let valid = match self.kind {
            TransitionKind::Archive => {
                self.staging == format!(".chunkyard-archive-{}", self.id)
                    && self.previous.is_none()
                    && self.next.is_some()
            }
            TransitionKind::Restore => {
                self.staging
                    .strip_prefix(".chunkyard-restore-")
                    .is_some_and(|name| {
                        (6..=64).contains(&name.len())
                            && name.bytes().all(|b| b.is_ascii_alphanumeric())
                    })
                    && self.previous.is_some()
                    && self.next.is_none()
            }
        };
        if !valid {
            return Err(ServerError::Filesystem);
        }
        Ok(())
    }
}
pub(crate) fn journal_path(root: &Path, id: &str) -> PathBuf {
    root.join(format!(".chunkyard-transition-{id}.json"))
}

async fn directory(path: &Path) -> Result<bool, ServerError> {
    match tokio::fs::symlink_metadata(path).await {
        Ok(meta) if meta.is_dir() && !meta.file_type().is_symlink() => Ok(true),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        _ => Err(ServerError::Filesystem),
    }
}
pub(crate) async fn sync_root(root: &Path) -> Result<(), ServerError> {
    #[cfg(unix)]
    {
        let root = root.to_owned();
        tokio::task::spawn_blocking(move || std::fs::File::open(root)?.sync_all())
            .await
            .map_err(|_| ServerError::Filesystem)?
            .map_err(|_| ServerError::Filesystem)?;
    }
    #[cfg(not(unix))]
    let _ = root;
    Ok(())
}

/// The caller holds the instance lock, or is recovering before admitting HTTP requests.
async fn recover(
    root: &Path,
    repo: &dyn ServerRepo,
    transition: &Transition,
) -> Result<bool, ServerError> {
    transition.validate()?;
    let server = repo
        .get(&transition.id)
        .await?
        .ok_or(ServerError::Filesystem)?;
    let committed = server.archive == transition.next;
    if !committed && server.archive != transition.previous {
        return Err(ServerError::Filesystem);
    }
    let local = root.join(&transition.id);
    let staged = transition.staging_files(root);
    let has_local = directory(&local).await?;
    let has_staged = directory(&staged).await?;
    match (transition.kind, committed) {
        (TransitionKind::Archive, true) => {
            if has_local {
                return Err(ServerError::Filesystem);
            }
            if has_staged {
                tokio::fs::remove_dir_all(&staged)
                    .await
                    .map_err(|_| ServerError::Filesystem)?;
            }
        }
        (TransitionKind::Archive, false) => {
            if has_local && has_staged {
                return Err(ServerError::Filesystem);
            }
            if has_staged {
                tokio::fs::rename(&staged, &local)
                    .await
                    .map_err(|_| ServerError::Filesystem)?;
            } else if !has_local {
                return Err(ServerError::Filesystem);
            }
        }
        (TransitionKind::Restore, true) => {
            if has_local && has_staged {
                return Err(ServerError::Filesystem);
            }
            if !has_local {
                if !has_staged {
                    return Err(ServerError::Filesystem);
                }
                tokio::fs::rename(&staged, &local)
                    .await
                    .map_err(|_| ServerError::Filesystem)?;
            }
        }
        (TransitionKind::Restore, false) => {
            if has_local && has_staged {
                return Err(ServerError::Filesystem);
            }
            if has_local {
                let parent = root.join(&transition.staging);
                if !directory(&parent).await? {
                    tokio::fs::create_dir(parent)
                        .await
                        .map_err(|_| ServerError::Filesystem)?;
                }
                tokio::fs::rename(&local, &staged)
                    .await
                    .map_err(|_| ServerError::Filesystem)?;
            }
        }
    }
    if matches!(transition.kind, TransitionKind::Restore)
        && directory(&root.join(&transition.staging)).await?
    {
        tokio::fs::remove_dir_all(root.join(&transition.staging))
            .await
            .map_err(|_| ServerError::Filesystem)?;
    }
    sync_root(root).await?;
    tokio::fs::remove_file(transition.journal(root))
        .await
        .map_err(|_| ServerError::Filesystem)?;
    sync_root(root).await?;
    Ok(committed)
}

impl ServerManager {
    pub(crate) async fn recover_pending(&self, id: &str) -> Result<(), ServerError> {
        let path = journal_path(&self.root, id);
        match tokio::fs::symlink_metadata(&path).await {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Ok(meta) if meta.is_file() && meta.len() <= 65_536 => {}
            _ => return Err(ServerError::Filesystem),
        }
        let bytes = tokio::fs::read(path)
            .await
            .map_err(|_| ServerError::Filesystem)?;
        let transition: Transition =
            serde_json::from_slice(&bytes).map_err(|_| ServerError::Filesystem)?;
        if transition.id != id {
            return Err(ServerError::Filesystem);
        }
        recover(&self.root, self.repo.as_ref(), &transition).await?;
        Ok(())
    }
    /// Recover journals before serving requests; never guess when both directory copies exist.
    pub async fn recover_transitions(&self) -> Result<(), ServerError> {
        let mut entries = match tokio::fs::read_dir(&self.root).await {
            Ok(entries) => entries,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(_) => return Err(ServerError::Filesystem),
        };
        let mut inspected = 0;
        let mut abandoned_staging = Vec::new();
        while let Some(entry) = entries
            .next_entry()
            .await
            .map_err(|_| ServerError::Filesystem)?
        {
            inspected += 1;
            if inspected > 1000 {
                return Err(ServerError::Filesystem);
            }
            let name = entry.file_name();
            let Some(name) = name.to_str() else {
                continue;
            };
            if let Some(id) = name
                .strip_prefix(".chunkyard-transition-")
                .and_then(|name| name.strip_suffix(".json"))
            {
                Uuid::parse_str(id).map_err(|_| ServerError::Filesystem)?;
                self.recover_pending(id).await?;
            } else if name
                .strip_prefix(".chunkyard-restore-")
                .is_some_and(|suffix| {
                    (6..=64).contains(&suffix.len())
                        && suffix.bytes().all(|b| b.is_ascii_alphanumeric())
                })
            {
                abandoned_staging.push(entry.path());
            }
        }
        // All journals are resolved first. Unreferenced private restore directories
        // contain only incomplete/duplicate downloads, never a live instance.
        for staging in abandoned_staging {
            if directory(&staging).await? {
                tokio::fs::remove_dir_all(staging)
                    .await
                    .map_err(|_| ServerError::Filesystem)?;
            }
        }
        Ok(())
    }
}

pub(crate) async fn publish(
    root: &Path,
    repo: &dyn ServerRepo,
    server: &Server,
    transition: &Transition,
    operation: Arc<tokio::sync::OwnedMutexGuard<()>>,
) -> Result<(), chunkyard_core::exports::ExportError> {
    transition.validate()?;
    let (source, destination) = match transition.kind {
        TransitionKind::Archive => (root.join(&transition.id), transition.staging_files(root)),
        TransitionKind::Restore => (transition.staging_files(root), root.join(&transition.id)),
    };
    if !directory(&source).await? || tokio::fs::symlink_metadata(&destination).await.is_ok() {
        return Err(ServerError::Filesystem.into());
    }
    let bytes = serde_json::to_vec(transition).map_err(|_| ServerError::Filesystem)?;
    super::exports::private_write(transition.journal(root), bytes, operation).await?;
    sync_root(root).await?;
    tokio::fs::rename(source, destination).await?;
    sync_root(root).await?;
    let saved = repo.save(server).await;
    let committed = recover(root, repo, transition).await?;
    if !committed {
        return Err(saved
            .err()
            .map(ServerError::Storage)
            .unwrap_or(ServerError::Filesystem)
            .into());
    }
    Ok(())
}
