use fs2::FileExt;
use std::{
    fs::{self, File, OpenOptions},
    path::Path,
};

/// Protect credentials on disk and exclude a second daemon using the same database.
pub(crate) fn prepare(data: &Path) -> Result<File, std::io::Error> {
    let mut builder = fs::DirBuilder::new();
    builder.recursive(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder.create(data)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if fs::metadata(data)?.permissions().mode() & 0o022 != 0 {
            return Err(std::io::Error::new(
                std::io::ErrorKind::PermissionDenied,
                "data directory must not be writable by other users",
            ));
        }
    }
    let lock = private_file(&data.join(".manager.lock"))?;
    lock.try_lock_exclusive()?;
    private_file(&data.join("mcm.db"))?;
    // Existing WAL files may have been created by an earlier CLI-only run.
    // They contain database pages too, so tighten them before storing credentials.
    for name in ["mcm.db-wal", "mcm.db-shm"] {
        let path = data.join(name);
        match fs::symlink_metadata(&path) {
            Ok(_) => {
                private_file(&path)?;
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => (),
            Err(error) => return Err(error),
        }
    }
    Ok(lock)
}
fn private_file(path: &Path) -> Result<File, std::io::Error> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if !metadata.is_file() => {
            return Err(std::io::Error::new(
                std::io::ErrorKind::PermissionDenied,
                "data files must be regular files, not links",
            ));
        }
        Err(error) if error.kind() != std::io::ErrorKind::NotFound => return Err(error),
        _ => (),
    }
    let mut options = OpenOptions::new();
    options.create(true).truncate(false).read(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let file = options.open(path)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        file.set_permissions(fs::Permissions::from_mode(0o600))?;
    }
    Ok(file)
}

pub(crate) fn instance_id(data: &Path) -> Result<String, std::io::Error> {
    use std::io::{Read, Seek, Write};
    let mut file = private_file(&data.join("instance-id"))?;
    let size = file.metadata()?.len();
    if size == 0 {
        file.write_all(uuid::Uuid::new_v4().to_string().as_bytes())?;
        file.sync_all()?;
        file.rewind()?;
    } else if size != 36 {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "invalid instance-id file",
        ));
    }
    let mut id = String::new();
    file.take(37).read_to_string(&mut id)?;
    uuid::Uuid::parse_str(&id)
        .map(|id| id.to_string())
        .map_err(|_| {
            std::io::Error::new(std::io::ErrorKind::InvalidData, "invalid instance-id file")
        })
}
