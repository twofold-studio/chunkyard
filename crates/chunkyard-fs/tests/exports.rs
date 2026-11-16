use chunkyard_core::files::FileError;
use chunkyard_fs::sandbox::Sandbox;
type Result<T = ()> = std::result::Result<T, Box<dyn std::error::Error>>;

#[test]
fn overlapping_export_selections_preserve_unique_entries_and_report_actual_checksum() -> Result {
    use sha2::{Digest, Sha256};
    let root = tempfile::tempdir()?;
    let id = uuid::Uuid::new_v4().to_string();
    let directory = root.path().join(&id);
    std::fs::create_dir_all(directory.join("world/region"))?;
    std::fs::write(directory.join("world/region/test.mca"), "region")?;
    let output = tempfile::NamedTempFile::new()?;
    let (size, checksum) = Sandbox::open(root.path(), &id)?.export_archive(
        &["world/region".into(), "world".into(), "world".into()],
        false,
        output.reopen()?,
        b"{}",
        None,
    )?;
    let bytes = std::fs::read(output.path())?;
    assert_eq!(size, bytes.len() as u64);
    assert_eq!(checksum, format!("{:x}", Sha256::digest(&bytes)));
    let mut archive = tar::Archive::new(flate2::read::GzDecoder::new(&bytes[..]));
    let paths = archive
        .entries()?
        .map(|entry| {
            entry.and_then(|entry| {
                Ok(entry
                    .path()?
                    .to_string_lossy()
                    .trim_end_matches('/')
                    .to_owned())
            })
        })
        .collect::<std::io::Result<Vec<_>>>()?;
    assert_eq!(paths, ["world", "world/region", "world/region/test.mca"]);
    Ok(())
}

#[cfg(unix)]
#[test]
fn archives_never_follow_links_or_include_paths_outside_instance() -> Result {
    let root = tempfile::tempdir()?;
    let id = uuid::Uuid::new_v4().to_string();
    let directory = root.path().join(&id);
    std::fs::create_dir(&directory)?;
    std::fs::write(root.path().join("secret"), "outside")?;
    std::os::unix::fs::symlink(root.path().join("secret"), directory.join("link"))?;
    let fs = Sandbox::open(root.path(), &id)?;
    let output = tempfile::tempfile()?;
    assert!(matches!(
        fs.export_archive(&[], false, output, b"{}", None),
        Err(FileError::Symlink)
    ));
    for path in [
        "../secret",
        "/secret",
        ".chunkyard-software-secret/server.jar",
    ] {
        assert!(
            fs.export_archive(&[path.into()], false, tempfile::tempfile()?, b"{}", None)
                .is_err()
        );
    }
    Ok(())
}
#[test]
fn world_exports_find_nested_custom_worlds_and_keep_dimension_files() -> Result {
    let root = tempfile::tempdir()?;
    let id = uuid::Uuid::new_v4().to_string();
    let directory = root.path().join(&id);
    for path in ["saves/custom/DIM-1/region", "custom_nether/DIM-1"] {
        std::fs::create_dir_all(directory.join(path))?;
    }
    for path in [
        "saves/custom/level.dat",
        "saves/custom/DIM-1/region/test.mca",
        "custom_nether/level.dat",
        "other.txt",
    ] {
        std::fs::write(directory.join(path), "data")?;
    }
    let output = tempfile::NamedTempFile::new()?;
    Sandbox::open(root.path(), &id)?.export_archive(&[], true, output.reopen()?, b"{}", None)?;
    let mut archive = tar::Archive::new(flate2::read::GzDecoder::new(output.reopen()?));
    let paths = archive
        .entries()?
        .map(|e| e.and_then(|e| Ok(e.path()?.to_string_lossy().into_owned())))
        .collect::<std::io::Result<Vec<_>>>()?;
    assert!(
        paths
            .iter()
            .any(|p| p == "saves/custom/DIM-1/region/test.mca")
    );
    assert!(paths.iter().any(|p| p == "custom_nether/level.dat"));
    assert!(!paths.iter().any(|p| p == "other.txt"));
    Ok(())
}
