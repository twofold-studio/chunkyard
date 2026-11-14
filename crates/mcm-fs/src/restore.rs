//! Strict extraction of Chunkyard instance archives; no links or ambient archive paths.
use crate::ArchiveError;
use flate2::read::GzDecoder;
use mcm_core::progress::{ProgressReporter, Stage};
use std::{
    collections::HashSet,
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Component, Path},
};

pub fn extract_instance(
    source: &Path,
    destination: &Path,
    progress: ProgressReporter,
) -> Result<Vec<u8>, ArchiveError> {
    process_archive(source, Some(destination), progress, Stage::Restore)
}
pub fn inspect_instance(
    source: &Path,
    progress: ProgressReporter,
) -> Result<Vec<u8>, ArchiveError> {
    process_archive(source, None, progress, Stage::VerifyArchive)
}
fn process_archive(
    source: &Path,
    destination: Option<&Path>,
    progress: ProgressReporter,
    stage: Stage,
) -> Result<Vec<u8>, ArchiveError> {
    if let Some(destination) = destination {
        fs::create_dir(destination)?;
    }
    let mut archive = tar::Archive::new(GzDecoder::new(File::open(source)?));
    let mut paths = HashSet::new();
    let mut total = 0_u64;
    let mut written = 0_u64;
    let mut manifest = None;
    let mut pending_name = None;
    let mut regular_entries = 0;
    progress.bytes(stage, Some(0), None);
    for (index, entry) in archive.entries()?.raw(true).enumerate() {
        if index >= 200_000 {
            return Err(ArchiveError::Limit);
        }
        let mut entry = entry?;
        let kind = entry.header().entry_type();
        if kind.is_gnu_longname() {
            if pending_name.is_some() || entry.size() > 4097 {
                return Err(ArchiveError::Limit);
            }
            let mut name = Vec::new();
            entry.read_to_end(&mut name)?;
            if name.last() == Some(&0) {
                name.pop();
            }
            pending_name = Some(std::path::PathBuf::from(
                String::from_utf8(name).map_err(|_| ArchiveError::UnsafeEntry)?,
            ));
            continue;
        }
        regular_entries += 1;
        if regular_entries > 100_000 {
            return Err(ArchiveError::Limit);
        }
        let path = match pending_name.take() {
            Some(path) => path,
            None => entry.path()?.into_owned(),
        };
        let text = path.to_str().ok_or(ArchiveError::UnsafeEntry)?;
        if text.len() > 4096
            || path.components().count() > 64
            || text.contains(['\\', ':'])
            || text.chars().any(char::is_control)
            || path.as_os_str().is_empty()
            || path
                .components()
                .any(|c| !matches!(c, Component::Normal(_)))
            || !paths.insert(path.clone())
        {
            return Err(ArchiveError::UnsafeEntry);
        }
        let output = destination.map(|destination| destination.join(&path));
        if kind.is_dir() {
            if entry.size() != 0 {
                return Err(ArchiveError::UnsafeEntry);
            }
            if let Some(output) = &output {
                fs::create_dir_all(output)?;
            }
        } else if kind.is_file() {
            let size = entry.size();
            total = total.checked_add(size).ok_or(ArchiveError::Limit)?;
            if total > 100 * 1024 * 1024 * 1024 {
                return Err(ArchiveError::Limit);
            }
            let is_manifest = text == ".chunkyard-export.json";
            if is_manifest && size > 1024 * 1024 {
                return Err(ArchiveError::Limit);
            }
            let mut contents = Vec::new();
            let mut file = if let Some(output) = &output {
                if let Some(parent) = output.parent() {
                    fs::create_dir_all(parent)?;
                }
                Some(
                    OpenOptions::new()
                        .write(true)
                        .create_new(true)
                        .open(output)?,
                )
            } else {
                None
            };
            let mut buffer = [0; 128 * 1024];
            let mut copied = 0;
            loop {
                let n = entry.read(&mut buffer)?;
                if n == 0 {
                    break;
                }
                copied += n as u64;
                if copied > size {
                    return Err(ArchiveError::Limit);
                }
                if let Some(file) = &mut file {
                    file.write_all(&buffer[..n])?;
                }
                if is_manifest {
                    contents.extend_from_slice(&buffer[..n]);
                }
                written += n as u64;
                progress.bytes(stage, Some(written), None);
            }
            if copied != size {
                return Err(ArchiveError::Limit);
            }
            if let Some(file) = &file {
                file.sync_all()?;
            }
            if is_manifest {
                manifest = Some(contents);
            }
        } else {
            return Err(ArchiveError::UnsafeEntry);
        }
    }
    if pending_name.is_some() {
        return Err(ArchiveError::UnsafeEntry);
    }
    // Consume the gzip trailer too; tar end markers alone do not validate its CRC.
    let mut decoder = archive.into_inner();
    let mut remaining = [0; 8192];
    let mut padding = 0;
    loop {
        let n = decoder.read(&mut remaining)?;
        if n == 0 {
            break;
        }
        padding += n;
        if padding > 1024 * 1024 || remaining[..n].iter().any(|b| *b != 0) {
            return Err(ArchiveError::UnsafeEntry);
        }
    }
    let manifest = manifest.ok_or(ArchiveError::UnsafeEntry)?;
    #[cfg(unix)]
    if let Some(destination) = destination {
        sync_directories(destination)?;
    }
    Ok(manifest)
}

#[cfg(unix)]
fn sync_directories(path: &Path) -> Result<(), ArchiveError> {
    for entry in fs::read_dir(path)? {
        let entry = entry?;
        if entry.file_type()?.is_dir() {
            sync_directories(&entry.path())?;
        }
    }
    File::open(path)?.sync_all()?;
    Ok(())
}
