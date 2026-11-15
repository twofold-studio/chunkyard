use chunkyard_core::files::{FileError, Transfer, WriteContent};
use chunkyard_fs::sandbox::Sandbox;
use std::io::Read;
type Result<T = ()> = std::result::Result<T, Box<dyn std::error::Error>>;

struct Fixture {
    root: tempfile::TempDir,
    id: String,
    fs: Sandbox,
}
impl Fixture {
    fn new() -> Result<Self> {
        let root = tempfile::tempdir()?;
        let id = uuid::Uuid::new_v4().to_string();
        std::fs::create_dir(root.path().join(&id))?;
        let fs = Sandbox::open(root.path(), &id)?;
        Ok(Self { root, id, fs })
    }
    fn path(&self) -> std::path::PathBuf {
        self.root.path().join(&self.id)
    }
}
#[test]
fn text_editor_detects_stale_saves_and_never_truncates_existing_file() -> Result {
    let f = Fixture::new()?;
    let saved = f.fs.save(
        "server.properties".into(),
        WriteContent {
            content: "online-mode=true\n".into(),
            etag: None,
        },
    )?;
    assert!(matches!(
        f.fs.save(
            "server.properties".into(),
            WriteContent {
                content: "overwrite".into(),
                etag: None
            }
        ),
        Err(FileError::Conflict)
    ));
    std::fs::write(f.path().join("server.properties"), "changed externally")?;
    assert!(matches!(
        f.fs.save(
            "server.properties".into(),
            WriteContent {
                content: "stale".into(),
                etag: Some(saved.etag)
            }
        ),
        Err(FileError::Conflict)
    ));
    assert_eq!(
        std::fs::read_to_string(f.path().join("server.properties"))?,
        "changed externally"
    );
    Ok(())
}
#[test]
fn paths_cannot_escape_instance_or_modify_managed_files() -> Result {
    let f = Fixture::new()?;
    for path in [
        "../secret",
        "/etc/passwd",
        "a/../../secret",
        "a\\secret",
        "file:stream",
        "NUL",
        "dir/COM1.txt",
        "a//b",
        "a/./b",
        "trailing.",
    ] {
        assert!(
            matches!(
                f.fs.save(
                    path.into(),
                    WriteContent {
                        content: "x".into(),
                        etag: None
                    }
                ),
                Err(FileError::Path)
            ),
            "{path}"
        );
    }
    for path in [".chunkyard-managed.jar", "a/.chunkyard-secret", "EULA.TXT"] {
        assert!(
            matches!(
                f.fs.save(
                    path.into(),
                    WriteContent {
                        content: "x".into(),
                        etag: None
                    }
                ),
                Err(FileError::Protected)
            ),
            "{path}"
        );
    }
    assert!(f.fs.delete("".into(), true).is_err());
    Ok(())
}
#[test]
fn upload_download_copy_move_and_recursive_delete_preserve_bytes() -> Result {
    let f = Fixture::new()?;
    f.fs.mkdir("world".into())?;
    let bytes = vec![0, 1, 2, 255];
    f.fs.upload(
        "world/level.dat".into(),
        false,
        Box::new(std::io::Cursor::new(bytes.clone())),
    )?;
    assert!(matches!(
        f.fs.content("world/level.dat".into(), true),
        Err(FileError::Binary)
    ));
    f.fs.transfer(
        Transfer {
            from: "world".into(),
            to: "world-copy".into(),
        },
        true,
    )?;
    f.fs.transfer(
        Transfer {
            from: "world-copy/level.dat".into(),
            to: "world-copy/moved.dat".into(),
        },
        false,
    )?;
    let mut download = f.fs.download("world-copy/moved.dat".into())?;
    let mut actual = Vec::new();
    download.file.read_to_end(&mut actual)?;
    assert_eq!(actual, bytes);
    assert!(matches!(
        f.fs.delete("world-copy".into(), false),
        Err(FileError::NotEmpty)
    ));
    f.fs.delete("world-copy".into(), true)?;
    assert!(!f.path().join("world-copy").exists());
    Ok(())
}
#[test]
fn interrupted_upload_keeps_original_and_removes_staging_file() -> Result {
    struct Broken;
    impl Read for Broken {
        fn read(&mut self, _: &mut [u8]) -> std::io::Result<usize> {
            Err(std::io::Error::other("disconnected"))
        }
    }
    let f = Fixture::new()?;
    std::fs::write(f.path().join("file"), "original")?;
    assert!(f.fs.upload("file".into(), true, Box::new(Broken)).is_err());
    assert_eq!(std::fs::read_to_string(f.path().join("file"))?, "original");
    assert_eq!(std::fs::read_dir(f.path())?.count(), 1);
    Ok(())
}
#[test]
fn oversized_text_and_upload_are_bounded_and_not_published() -> Result {
    let f = Fixture::new()?;
    let oversized = "a".repeat(chunkyard_core::files::TEXT_LIMIT as usize + 1);
    assert!(matches!(
        f.fs.save(
            "text".into(),
            WriteContent {
                content: oversized,
                etag: None
            }
        ),
        Err(FileError::TooLarge)
    ));
    let reader = std::io::repeat(1).take(chunkyard_core::files::UPLOAD_LIMIT + 1);
    assert!(matches!(
        f.fs.upload("huge".into(), false, Box::new(reader)),
        Err(FileError::TooLarge)
    ));
    assert_eq!(std::fs::read_dir(f.path())?.count(), 0);
    Ok(())
}

#[test]
fn oversized_directory_copy_removes_only_its_new_destination() -> Result {
    let f = Fixture::new()?;
    f.fs.mkdir("source".into())?;
    std::fs::write(f.path().join("keep"), "keep")?;
    let sparse = std::fs::File::create(f.path().join("source/large"))?;
    sparse.set_len(512 * 1024 * 1024 + 1)?;
    assert!(matches!(
        f.fs.transfer(
            Transfer {
                from: "source".into(),
                to: "failed-copy".into()
            },
            true
        ),
        Err(FileError::TooLarge)
    ));
    assert!(!f.path().join("failed-copy").exists());
    assert_eq!(std::fs::read_to_string(f.path().join("keep"))?, "keep");
    Ok(())
}

#[cfg(unix)]
#[test]
fn linked_instance_roots_are_rejected() -> Result {
    let root = tempfile::tempdir()?;
    let outside = tempfile::tempdir()?;
    let id = uuid::Uuid::new_v4().to_string();
    std::os::unix::fs::symlink(outside.path(), root.path().join(&id))?;
    assert!(matches!(
        Sandbox::open(root.path(), &id),
        Err(FileError::Symlink)
    ));
    Ok(())
}
#[cfg(unix)]
#[test]
fn links_are_visible_but_never_followed_and_copy_failure_cleans_target() -> Result {
    let f = Fixture::new()?;
    let outside = tempfile::tempdir()?;
    std::fs::write(outside.path().join("secret"), "host secret")?;
    std::os::unix::fs::symlink(outside.path(), f.path().join("link"))?;
    std::os::unix::fs::symlink(outside.path().join("secret"), f.path().join("file-link"))?;
    for path in ["link/secret", "file-link"] {
        assert!(matches!(
            f.fs.content(path.into(), true),
            Err(FileError::Symlink)
        ));
        assert!(
            f.fs.upload(
                path.into(),
                true,
                Box::new(std::io::Cursor::new(b"overwrite"))
            )
            .is_err()
        );
    }
    assert!(
        f.fs.list("".into(), true)?
            .entries
            .iter()
            .any(|e| e.name == "link")
    );
    f.fs.mkdir("nested".into())?;
    std::os::unix::fs::symlink(outside.path(), f.path().join("nested/link"))?;
    assert!(
        f.fs.transfer(
            Transfer {
                from: "nested".into(),
                to: "copy".into()
            },
            true
        )
        .is_err()
    );
    assert!(!f.path().join("copy").exists());
    assert_eq!(
        std::fs::read_to_string(outside.path().join("secret"))?,
        "host secret"
    );
    Ok(())
}
