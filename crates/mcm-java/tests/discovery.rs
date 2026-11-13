#![cfg(unix)]
use mcm_java::{DiscoveryPaths, discover, identify};
use std::{
    error::Error,
    fs,
    os::unix::fs::{PermissionsExt, symlink},
    path::{Path, PathBuf},
};

fn java(home: &Path, version: &str) -> Result<PathBuf, Box<dyn Error>> {
    fs::create_dir_all(home.join("bin"))?;
    let path = home.join("bin/java");
    fs::write(
        &path,
        format!("#!/bin/sh\nprintf 'openjdk version \"{version}\"\\n' >&2\n"),
    )?;
    fs::set_permissions(&path, fs::Permissions::from_mode(0o755))?;
    fs::write(
        home.join("release"),
        format!(
            "IMPLEMENTOR=\"Test Vendor\"\nOS_ARCH=\"{}\"\n",
            std::env::consts::ARCH
        ),
    )?;
    Ok(path)
}

#[tokio::test]
async fn discovers_legacy_java_and_deduplicates_symlinks() -> Result<(), Box<dyn Error>> {
    let directory = tempfile::tempdir()?;
    let executable = java(&directory.path().join("jdk8"), "1.8.0_432")?;
    let alias = directory.path().join("alias");
    symlink(&executable, &alias)?;
    let paths = DiscoveryPaths {
        candidates: vec![executable, alias],
        roots: vec![],
    };
    let runtimes = discover(paths, &directory.path().join("managed")).await?;
    assert_eq!(runtimes.len(), 1);
    assert_eq!(runtimes[0].major, 8);
    assert_eq!(runtimes[0].vendor, "Test Vendor");
    Ok(())
}

#[tokio::test]
async fn excludes_managed_runtimes_and_skips_broken_candidates() -> Result<(), Box<dyn Error>> {
    let directory = tempfile::tempdir()?;
    let root = directory.path().join("managed");
    let executable = java(&root.join("jdk21"), "21.0.10")?;
    let broken = java(&directory.path().join("broken"), "unknown")?;
    let paths = DiscoveryPaths {
        candidates: vec![executable, broken, directory.path().join("missing")],
        roots: vec![],
    };
    assert!(discover(paths, &root).await?.is_empty());
    Ok(())
}

#[tokio::test]
async fn rejects_nonzero_exit_and_unbounded_output() -> Result<(), Box<dyn Error>> {
    let directory = tempfile::tempdir()?;
    let executable = java(directory.path(), "21")?;
    fs::write(
        &executable,
        "#!/bin/sh\nprintf 'openjdk version \"21\"\\n' >&2\nexit 1\n",
    )?;
    assert!(identify(&executable).await.is_err());
    fs::write(
        &executable,
        "#!/bin/sh\ni=0\nwhile [ $i -lt 10000 ]; do printf 'too much output\\n'; i=$((i+1)); done\n",
    )?;
    assert!(identify(&executable).await.is_err());
    Ok(())
}
