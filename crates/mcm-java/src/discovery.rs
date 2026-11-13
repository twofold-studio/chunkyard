use crate::{JavaError, identify, platform::java_name};
use futures_util::{StreamExt, stream};
use mcm_core::java::JavaRuntime;
use std::{
    collections::BTreeSet,
    path::{Path, PathBuf},
};

/// Explicit search inputs make discovery deterministic in tests and avoid mutating process env.
#[derive(Debug, Default)]
pub struct DiscoveryPaths {
    pub candidates: Vec<PathBuf>,
    pub roots: Vec<PathBuf>,
}

impl DiscoveryPaths {
    pub fn system() -> Self {
        let mut paths = Self::default();
        if let Some(home) = std::env::var_os("JAVA_HOME") {
            paths
                .candidates
                .push(PathBuf::from(home).join("bin").join(java_name()));
        }
        if let Some(path) = std::env::var_os("PATH") {
            paths
                .candidates
                .extend(std::env::split_paths(&path).map(|p| p.join(java_name())));
        }
        #[cfg(target_os = "linux")]
        {
            paths
                .roots
                .extend(["/usr/lib/jvm", "/usr/java", "/opt/java", "/opt"].map(PathBuf::from));
            if let Some(home) = std::env::var_os("HOME") {
                paths
                    .roots
                    .push(PathBuf::from(home).join(".sdkman/candidates/java"));
            }
        }
        #[cfg(windows)]
        {
            for variable in ["ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"] {
                if let Some(base) = std::env::var_os(variable) {
                    for vendor in [
                        "Java",
                        "Eclipse Adoptium",
                        "Microsoft",
                        "Zulu",
                        "Programs/Eclipse Adoptium",
                    ] {
                        paths.roots.push(PathBuf::from(&base).join(vendor));
                    }
                }
            }
        }
        paths
    }
}

/// Deduplicate symlink aliases and probe at most four executables concurrently.
/// Managed runtimes are excluded from the system inventory.
pub async fn discover(
    paths: DiscoveryPaths,
    managed_root: &Path,
) -> Result<Vec<JavaRuntime>, JavaError> {
    let mut candidates = paths.candidates;
    for root in paths.roots {
        for home in children(&root).await {
            candidates.push(home.join("bin").join(java_name()));
            candidates.push(home.join("jre/bin").join(java_name()));
            // /opt/<vendor>/jdk*/bin/java and vendors with nested install layouts.
            for nested in children(&home).await {
                candidates.push(nested.join("bin").join(java_name()));
            }
        }
    }
    let managed_root = tokio::fs::canonicalize(managed_root)
        .await
        .unwrap_or_else(|_| managed_root.to_path_buf());
    let mut seen = BTreeSet::new();
    for candidate in candidates {
        if let Ok(path) = tokio::fs::canonicalize(candidate).await
            && !path.starts_with(&managed_root)
            && path.is_file()
        {
            seen.insert(path);
        }
    }
    let mut runtimes: Vec<_> = stream::iter(seen)
        .map(|path| async move {
            match identify(&path).await {
                Ok(runtime) => Some(runtime),
                Err(error) => {
                    tracing::debug!(?path, %error, "skipping Java candidate");
                    None
                }
            }
        })
        .buffer_unordered(4)
        .filter_map(async move |r| r)
        .collect()
        .await;
    runtimes.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(runtimes)
}

async fn children(root: &Path) -> Vec<PathBuf> {
    let mut result = Vec::new();
    if let Ok(mut entries) = tokio::fs::read_dir(root).await {
        while let Ok(Some(entry)) = entries.next_entry().await {
            if result.len() >= 512 {
                break;
            }
            if entry.file_type().await.is_ok_and(|kind| kind.is_dir()) {
                result.push(entry.path());
            }
        }
    }
    result
}
