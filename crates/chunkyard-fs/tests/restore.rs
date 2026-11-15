use flate2::{Compression, write::GzEncoder};
use std::{fs::File, io::Write, path::Path};
type Result<T = ()> = std::result::Result<T, Box<dyn std::error::Error>>;

fn archive(path: &Path, entries: &[(&str, &[u8], tar::EntryType)]) -> Result {
    let mut builder = tar::Builder::new(GzEncoder::new(File::create(path)?, Compression::fast()));
    for (name, bytes, kind) in entries {
        let mut header = tar::Header::new_gnu();
        header.set_size(bytes.len() as u64);
        header.set_mode(0o644);
        header.set_entry_type(*kind);
        builder.append_data(&mut header, name, *bytes)?;
    }
    builder.into_inner()?.finish()?;
    Ok(())
}
#[test]
fn restores_exact_bytes_and_long_paths_with_a_manifest() -> Result {
    let dir = tempfile::tempdir()?;
    let source = dir.path().join("backup.gz");
    let long = format!("libraries/{}/server.jar", "deep/".repeat(30));
    archive(
        &source,
        &[
            (
                ".chunkyard-export.json",
                b"manifest",
                tar::EntryType::Regular,
            ),
            (
                "world/region/r.0.0.mca",
                b"world bytes",
                tar::EntryType::Regular,
            ),
            (&long, b"jar bytes", tar::EntryType::Regular),
        ],
    )?;
    assert_eq!(
        chunkyard_fs::inspect_instance(&source, Default::default())?,
        b"manifest"
    );
    let destination = dir.path().join("restored");
    assert_eq!(
        chunkyard_fs::extract_instance(&source, &destination, Default::default())?,
        b"manifest"
    );
    assert_eq!(std::fs::read(destination.join(long))?, b"jar bytes");
    assert_eq!(
        std::fs::read(destination.join("world/region/r.0.0.mca"))?,
        b"world bytes"
    );
    Ok(())
}
#[test]
fn rejects_links_duplicates_and_bad_gzip_trailers() -> Result {
    let dir = tempfile::tempdir()?;
    for (index, entries) in [
        vec![
            (
                ".chunkyard-export.json",
                b"{}".as_slice(),
                tar::EntryType::Regular,
            ),
            ("world/link", b"".as_slice(), tar::EntryType::Symlink),
        ],
        vec![
            (
                ".chunkyard-export.json",
                b"{}".as_slice(),
                tar::EntryType::Regular,
            ),
            ("same", b"a".as_slice(), tar::EntryType::Regular),
            ("same", b"b".as_slice(), tar::EntryType::Regular),
        ],
    ]
    .into_iter()
    .enumerate()
    {
        let source = dir.path().join(format!("bad-{index}.gz"));
        archive(&source, &entries)?;
        assert!(chunkyard_fs::inspect_instance(&source, Default::default()).is_err());
    }
    let source = dir.path().join("crc.gz");
    archive(
        &source,
        &[(".chunkyard-export.json", b"{}", tar::EntryType::Regular)],
    )?;
    let mut bytes = std::fs::read(&source)?;
    let crc = bytes.len() - 8;
    bytes[crc] ^= 1;
    std::fs::write(&source, bytes)?;
    assert!(chunkyard_fs::inspect_instance(&source, Default::default()).is_err());
    Ok(())
}
#[test]
fn rejects_traversal_and_oversized_metadata_before_allocating() -> Result {
    let dir = tempfile::tempdir()?;
    for (index, name, size, kind) in [
        (0, "../escape", 0, tar::EntryType::Regular),
        (1, "/absolute", 0, tar::EntryType::Regular),
        (2, "world\\escape", 0, tar::EntryType::Regular),
        (3, "longname", 1_000_000_000, tar::EntryType::GNULongName),
        (4, "huge", 101 * 1024 * 1024 * 1024, tar::EntryType::Regular),
    ] {
        let source = dir.path().join(format!("unsafe-{index}.gz"));
        let mut header = tar::Header::new_gnu();
        header.set_size(size);
        header.set_mode(0o644);
        header.set_entry_type(kind);
        header.as_mut_bytes()[..name.len()].copy_from_slice(name.as_bytes());
        header.set_cksum();
        let mut encoder = GzEncoder::new(File::create(&source)?, Compression::fast());
        encoder.write_all(header.as_bytes())?;
        encoder.write_all(&[0; 1024])?;
        encoder.finish()?;
        assert!(chunkyard_fs::inspect_instance(&source, Default::default()).is_err());
    }
    assert!(!dir.path().join("escape").exists());
    Ok(())
}
