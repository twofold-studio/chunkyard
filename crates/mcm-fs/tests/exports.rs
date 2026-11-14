use mcm_core::files::FileError;
use mcm_fs::sandbox::Sandbox;
type Result<T = ()> = std::result::Result<T, Box<dyn std::error::Error>>;
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
