use chunkyard_config::Config;
use chunkyard_server::wiring::build_state;
type Result<T = ()> = std::result::Result<T, Box<dyn std::error::Error>>;
#[tokio::test]
async fn only_one_daemon_owns_a_data_directory_and_setup_token_survives_restart() -> Result {
    let directory = tempfile::tempdir()?;
    let config = Config {
        data_dir: directory.path().to_owned(),
        ..Config::default()
    };
    let backend = build_state(&config).await?;
    let token = std::fs::read_to_string(directory.path().join("setup-token"))?;
    assert!(build_state(&config).await.is_err());
    backend.shutdown().await;
    drop(backend);
    let reopened = build_state(&config).await?;
    assert_eq!(
        std::fs::read_to_string(directory.path().join("setup-token"))?,
        token
    );
    reopened.shutdown().await;
    Ok(())
}
#[cfg(unix)]
#[tokio::test]
async fn credential_files_are_private_and_symlinked_database_paths_are_rejected() -> Result {
    use std::os::unix::fs::{PermissionsExt, symlink};
    let directory = tempfile::tempdir()?;
    let config = Config {
        data_dir: directory.path().to_owned(),
        ..Config::default()
    };
    let backend = build_state(&config).await?;
    for name in ["mcm.db", "mcm.db-wal", "mcm.db-shm", "setup-token"] {
        assert_eq!(
            std::fs::metadata(directory.path().join(name))?
                .permissions()
                .mode()
                & 0o077,
            0
        );
    }
    backend.shutdown().await;
    drop(backend);
    let other = tempfile::tempdir()?;
    symlink(directory.path().join("mcm.db"), other.path().join("mcm.db"))?;
    let config = Config {
        data_dir: other.path().to_owned(),
        ..Config::default()
    };
    assert!(build_state(&config).await.is_err());
    Ok(())
}
