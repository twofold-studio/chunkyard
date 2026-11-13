use mcm_core::java::{JavaRuntime, JavaRuntimeId, JavaRuntimeRepo};
use mcm_db::SqliteJavaRuntimeRepo;
use std::{error::Error, path::PathBuf};

fn runtime(path: PathBuf, managed: bool) -> Result<JavaRuntime, Box<dyn Error>> {
    Ok(JavaRuntime {
        id: serde_json::from_str::<JavaRuntimeId>("\"00000000-0000-4000-8000-000000000001\"")?,
        vendor: "test".into(),
        major: 21,
        full_version: "21.0.10".into(),
        os: "linux".into(),
        arch: "x64".into(),
        path,
        managed,
        sha256: None,
    })
}

#[tokio::test]
async fn survives_reopen_and_preserves_identity_on_upsert() -> Result<(), Box<dyn Error>> {
    let directory = tempfile::tempdir()?;
    let database = directory.path().join("test.db");
    let repo = SqliteJavaRuntimeRepo::open(&database).await?;
    let original = runtime(directory.path().join("java"), false)?;
    repo.upsert(&original).await?;
    let mut changed = original.clone();
    changed.id = serde_json::from_str("\"00000000-0000-4000-8000-000000000002\"")?;
    changed.vendor = "changed vendor".into();
    repo.upsert(&changed).await?;
    let reopened = SqliteJavaRuntimeRepo::open(&database).await?;
    let rows = reopened.list().await?;
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].id, original.id);
    assert_eq!(rows[0].vendor, "changed vendor");
    Ok(())
}

#[tokio::test]
async fn rescan_removes_vanished_system_runtimes_and_keeps_managed() -> Result<(), Box<dyn Error>> {
    let directory = tempfile::tempdir()?;
    let repo = SqliteJavaRuntimeRepo::open(&directory.path().join("test.db")).await?;
    let managed = runtime(directory.path().join("managed/java"), true)?;
    let mut system = runtime(directory.path().join("system/java"), false)?;
    system.id = serde_json::from_str("\"00000000-0000-4000-8000-000000000002\"")?;
    repo.upsert(&managed).await?;
    repo.replace_system(&[system]).await?;
    repo.replace_system(&[]).await?;
    assert_eq!(repo.list().await?, [managed]);
    Ok(())
}

#[tokio::test]
async fn invalid_refresh_rolls_back_deletions() -> Result<(), Box<dyn Error>> {
    let directory = tempfile::tempdir()?;
    let repo = SqliteJavaRuntimeRepo::open(&directory.path().join("test.db")).await?;
    let system = runtime(directory.path().join("java"), false)?;
    repo.upsert(&system).await?;
    let mut invalid = system.clone();
    invalid.managed = true;
    assert!(repo.replace_system(&[invalid]).await.is_err());
    assert_eq!(repo.list().await?, [system]);
    Ok(())
}
