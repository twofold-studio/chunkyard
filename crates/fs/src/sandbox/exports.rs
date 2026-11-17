//! Bounded archive traversal and world discovery through directory capabilities.
use super::{
    Sandbox,
    access::{join, metadata_optional, nofollow_dir, regular, validate},
};
use cap_std::fs::Dir;
use chunkyard_core::files::*;
use sha2::{Digest, Sha256};
use std::io::{Read, Write};

impl Sandbox {
    /// Write a bounded, link-free tar.gz through the same directory capabilities as file access.
    /// Empty selections mean the whole instance; managed paths are only included in that mode.
    pub fn export_archive(
        &self,
        paths: &[String],
        world_only: bool,
        output: std::fs::File,
        manifest: &[u8],
        properties: Option<&str>,
    ) -> Result<(u64, String), FileError> {
        self.export_archive_with_progress(
            paths,
            world_only,
            output,
            manifest,
            properties,
            Default::default(),
        )
    }
    pub fn export_archive_with_progress(
        &self,
        paths: &[String],
        world_only: bool,
        output: std::fs::File,
        manifest: &[u8],
        properties: Option<&str>,
        progress: chunkyard_core::progress::ProgressReporter,
    ) -> Result<(u64, String), FileError> {
        use flate2::{Compression, write::GzEncoder};
        progress.stage(chunkyard_core::progress::Stage::Scan);
        let all = paths.is_empty() && !world_only;
        if !all {
            for path in paths {
                validate(path, false, false)?;
            }
        }
        let selected = if world_only {
            let mut worlds = Vec::new();
            let mut count = 0;
            find_worlds(&self.root, "", &mut worlds, &mut count)?;
            if worlds.is_empty() {
                return Err(FileError::NotFound);
            }
            worlds
        } else if all {
            vec![String::new()]
        } else {
            // Collapse overlapping selections so tar entries remain unique.
            let mut paths = paths.to_vec();
            paths.sort();
            paths.dedup();
            let mut roots: Vec<String> = Vec::new();
            for path in paths {
                if !roots.iter().any(|p| path.starts_with(&format!("{p}/"))) {
                    roots.push(path);
                }
            }
            roots
        };
        let writer = ArchiveWriter {
            progress,
            output,
            size: 0,
            hash: Sha256::new(),
        };
        let mut tar = tar::Builder::new(GzEncoder::new(writer, Compression::fast()));
        let mut budget = ExportBudget {
            entries: 0,
            bytes: 0,
        };
        for path in selected {
            if path.is_empty() {
                archive_directory(&self.root, "", &mut tar, &mut budget, all, properties)?;
            } else {
                let (dir, name) = self.parent(&path, false)?;
                archive_entry(&dir, &name, &path, &mut tar, &mut budget, all, properties)?;
            }
        }
        if all {
            append_bytes(&mut tar, ".chunkyard-export.json", manifest)?;
            if let Some(content) = properties {
                append_bytes(&mut tar, "server.properties", content.as_bytes())?;
            }
        }
        let writer = tar.into_inner()?.finish()?;
        writer.output.sync_all()?;
        Ok((writer.size, format!("{:x}", writer.hash.finalize())))
    }
}

const EXPORT_ENTRIES: usize = 100_000;
struct ExportBudget {
    entries: usize,
    bytes: u64,
}
struct ArchiveWriter {
    progress: chunkyard_core::progress::ProgressReporter,
    output: std::fs::File,
    size: u64,
    hash: Sha256,
}
impl Write for ArchiveWriter {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        if bytes.len() as u64 > 5 * 1024 * 1024 * 1024 - self.size {
            return Err(std::io::Error::new(
                std::io::ErrorKind::FileTooLarge,
                "compressed export exceeds 5 GiB",
            ));
        }
        let n = self.output.write(bytes)?;
        self.size += n as u64;
        self.hash.update(&bytes[..n]);
        self.progress.bytes(
            chunkyard_core::progress::Stage::Compress,
            Some(self.size),
            None,
        );
        Ok(n)
    }
    fn flush(&mut self) -> std::io::Result<()> {
        self.output.flush()
    }
}
fn archive_header(size: u64, directory: bool) -> tar::Header {
    let mut header = tar::Header::new_gnu();
    header.set_size(size);
    header.set_mode(if directory { 0o755 } else { 0o644 });
    header.set_entry_type(if directory {
        tar::EntryType::Directory
    } else {
        tar::EntryType::Regular
    });
    header.set_cksum();
    header
}
fn append_bytes<W: Write>(
    tar: &mut tar::Builder<W>,
    path: &str,
    bytes: &[u8],
) -> Result<(), FileError> {
    tar.append_data(&mut archive_header(bytes.len() as u64, false), path, bytes)?;
    Ok(())
}
fn archive_directory<W: Write>(
    dir: &Dir,
    path: &str,
    tar: &mut tar::Builder<W>,
    budget: &mut ExportBudget,
    all: bool,
    properties: Option<&str>,
) -> Result<(), FileError> {
    for entry in dir.entries()? {
        let entry = entry?;
        let name = entry
            .file_name()
            .into_string()
            .map_err(|_| FileError::Path)?;
        archive_entry(dir, &name, &join(path, &name), tar, budget, all, properties)?;
    }
    Ok(())
}
fn archive_entry<W: Write>(
    dir: &Dir,
    name: &str,
    path: &str,
    tar: &mut tar::Builder<W>,
    budget: &mut ExportBudget,
    all: bool,
    properties: Option<&str>,
) -> Result<(), FileError> {
    // The export manifest and desired properties supersede stale physical copies.
    if all
        && (path == ".chunkyard-export.json"
            || (path == "server.properties" && properties.is_some()))
    {
        return Ok(());
    }
    // Managed software paths are allowed only for a full backup, never arbitrary selections.
    let checked = if all {
        path.split('/')
            .map(|s| s.strip_prefix(".chunkyard-").unwrap_or(s))
            .collect::<Vec<_>>()
            .join("/")
    } else {
        path.to_owned()
    };
    validate(&checked, false, false)?;
    budget.entries += 1;
    if budget.entries > EXPORT_ENTRIES {
        return Err(FileError::TooLarge);
    }
    let metadata = dir.symlink_metadata(name)?;
    if metadata.is_symlink() {
        return Err(FileError::Symlink);
    }
    if metadata.is_dir() {
        tar.append_data(&mut archive_header(0, true), path, std::io::empty())?;
        archive_directory(
            &nofollow_dir(dir, name)?,
            path,
            tar,
            budget,
            all,
            properties,
        )
    } else {
        let file = regular(dir, name)?;
        let size = file.metadata()?.len();
        budget.bytes = budget.bytes.checked_add(size).ok_or(FileError::TooLarge)?;
        if budget.bytes > 100 * 1024 * 1024 * 1024 {
            return Err(FileError::TooLarge);
        }
        tar.append_data(&mut archive_header(size, false), path, file.take(size))?;
        Ok(())
    }
}
fn find_worlds(
    dir: &Dir,
    path: &str,
    worlds: &mut Vec<String>,
    count: &mut usize,
) -> Result<(), FileError> {
    if metadata_optional(dir, "level.dat")?.is_some() {
        let _ = regular(dir, "level.dat")?;
        worlds.push(path.to_owned());
        return Ok(());
    }
    for entry in dir.entries()? {
        *count += 1;
        if *count > EXPORT_ENTRIES {
            return Err(FileError::TooLarge);
        }
        let entry = entry?;
        let name = entry
            .file_name()
            .into_string()
            .map_err(|_| FileError::Path)?;
        let next = join(path, &name);
        if validate(&next, false, false).is_err() {
            continue;
        }
        let metadata = dir.symlink_metadata(&name)?;
        if metadata.is_symlink() {
            continue;
        }
        if metadata.is_dir() {
            find_worlds(&nofollow_dir(dir, &name)?, &next, worlds, count)?;
        }
    }
    Ok(())
}
