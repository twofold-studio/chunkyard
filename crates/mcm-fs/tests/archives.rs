use mcm_fs::{ArchiveFormat, extract};
use std::{error::Error, fs::File, io::Write};
use zip::{ZipWriter, write::SimpleFileOptions};

#[test]
fn extracts_zip_and_rejects_traversal() -> Result<(), Box<dyn Error>> {
    let dir = tempfile::tempdir()?;
    for (name, safe) in [
        ("jdk/bin/java.exe", true),
        ("../outside", false),
        ("C:/outside", false),
        ("a\\..\\outside", false),
    ] {
        let archive_path = dir.path().join("input.zip");
        let mut zip = ZipWriter::new(File::create(&archive_path)?);
        zip.start_file(name, SimpleFileOptions::default())?;
        zip.write_all(b"test executable")?;
        zip.finish()?;
        let destination = dir.path().join(format!("output-{}", name.len()));
        let result = extract(&archive_path, &destination, ArchiveFormat::Zip);
        assert_eq!(result.is_ok(), safe, "{name}");
    }
    assert!(!dir.path().join("outside").exists());
    Ok(())
}

#[cfg(unix)]
#[test]
fn extracts_internal_links_without_following_archive_links_for_writes() -> Result<(), Box<dyn Error>>
{
    use flate2::{Compression, write::GzEncoder};
    let dir = tempfile::tempdir()?;
    let source = dir.path().join("java.tar.gz");
    let mut archive = tar::Builder::new(GzEncoder::new(
        File::create(&source)?,
        Compression::default(),
    ));
    let mut header = tar::Header::new_gnu();
    header.set_size(4);
    header.set_mode(0o755);
    header.set_cksum();
    archive.append_data(&mut header, "jdk/bin/java", &b"java"[..])?;
    let mut link = tar::Header::new_gnu();
    link.set_entry_type(tar::EntryType::Symlink);
    link.set_size(0);
    link.set_mode(0o777);
    archive.append_link(&mut link, "jdk/bin/alias", "java")?;
    archive.into_inner()?.finish()?;
    let root = dir.path().join("output");
    extract(&source, &root, ArchiveFormat::TarGz)?;
    assert_eq!(std::fs::read(root.join("jdk/bin/alias"))?, b"java");
    Ok(())
}

#[cfg(unix)]
#[test]
fn rejects_symlink_escape() -> Result<(), Box<dyn Error>> {
    use flate2::{Compression, write::GzEncoder};
    let dir = tempfile::tempdir()?;
    let source = dir.path().join("evil.tar.gz");
    let mut archive = tar::Builder::new(GzEncoder::new(
        File::create(&source)?,
        Compression::default(),
    ));
    let mut header = tar::Header::new_gnu();
    header.set_entry_type(tar::EntryType::Symlink);
    header.set_size(0);
    header.set_mode(0o777);
    archive.append_link(&mut header, "jdk/link", "../../outside")?;
    archive.into_inner()?.finish()?;
    assert!(extract(&source, &dir.path().join("output"), ArchiveFormat::TarGz).is_err());
    Ok(())
}
