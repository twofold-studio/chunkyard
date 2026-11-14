use crate::ArchiveError;
use flate2::read::GzDecoder;
use std::{
    fs::{self, File, OpenOptions},
    io::{self, Read, Write},
    path::{Component, Path, PathBuf},
};

const MAX_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const MAX_ENTRIES: usize = 100_000;

#[derive(Debug, Clone, Copy)]
pub enum ArchiveFormat {
    TarGz,
    Zip,
}

/// Destination must not exist. Links are materialized only after regular files,
/// so no archive entry can traverse an earlier symlink during extraction.
pub fn extract(
    source: &Path,
    destination: &Path,
    format: ArchiveFormat,
) -> Result<(), ArchiveError> {
    fs::create_dir(destination)?;
    match format {
        ArchiveFormat::TarGz => extract_tar(source, destination),
        ArchiveFormat::Zip => extract_zip(source, destination, MAX_BYTES),
    }
}

fn safe_path(path: &Path) -> Result<(), ArchiveError> {
    if path.as_os_str().is_empty()
        || path
            .components()
            .any(|part| !matches!(part, Component::Normal(_) | Component::CurDir))
    {
        return Err(ArchiveError::UnsafeEntry);
    }
    // Also reject Windows separators and drive paths when extracting on Unix.
    if path.to_string_lossy().contains(['\\', ':']) {
        return Err(ArchiveError::UnsafeEntry);
    }
    Ok(())
}

fn copy_file(mut reader: impl Read, path: &Path, size: u64) -> Result<(), ArchiveError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut output = OpenOptions::new().write(true).create_new(true).open(path)?;
    let copied = io::copy(&mut reader.by_ref().take(size + 1), &mut output)?;
    if copied != size {
        return Err(ArchiveError::Limit);
    }
    output.flush()?;
    Ok(())
}

fn extract_tar(source: &Path, root: &Path) -> Result<(), ArchiveError> {
    let mut archive = tar::Archive::new(GzDecoder::new(File::open(source)?));
    let mut total = 0_u64;
    let mut links = Vec::new();
    for (index, entry) in archive.entries()?.enumerate() {
        if index >= MAX_ENTRIES {
            return Err(ArchiveError::Limit);
        }
        let mut entry = entry?;
        let path = entry.path()?.into_owned();
        safe_path(&path)?;
        let destination = root.join(&path);
        let kind = entry.header().entry_type();
        if kind.is_dir() {
            fs::create_dir_all(&destination)?;
        } else if kind.is_file() {
            let size = entry.size();
            total = total.checked_add(size).ok_or(ArchiveError::Limit)?;
            if total > MAX_BYTES {
                return Err(ArchiveError::Limit);
            }
            copy_file(&mut entry, &destination, size)?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                // Strip setuid/setgid and preserve executable bits for Java helpers.
                fs::set_permissions(
                    &destination,
                    fs::Permissions::from_mode(entry.header().mode()? & 0o755),
                )?;
            }
        } else if kind.is_symlink() {
            let target = entry
                .link_name()?
                .ok_or(ArchiveError::UnsafeEntry)?
                .into_owned();
            validate_link(&path, &target)?;
            links.push((path, target));
        } else {
            return Err(ArchiveError::UnsafeEntry);
        }
    }
    for (path, target) in links {
        let destination = root.join(path);
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent)?;
        }
        let parent = destination.parent().ok_or(ArchiveError::UnsafeEntry)?;
        let resolved_parent = fs::canonicalize(parent)?;
        let resolved_target = fs::canonicalize(parent.join(&target))?;
        let canonical_root = fs::canonicalize(root)?;
        if !resolved_parent.starts_with(&canonical_root)
            || !resolved_target.starts_with(&canonical_root)
        {
            return Err(ArchiveError::UnsafeEntry);
        }
        #[cfg(unix)]
        std::os::unix::fs::symlink(target, destination)?;
        #[cfg(not(unix))]
        {
            let _ = (target, destination);
            return Err(ArchiveError::UnsafeEntry);
        }
    }
    Ok(())
}

fn validate_link(path: &Path, target: &Path) -> Result<(), ArchiveError> {
    if target.is_absolute() || target.to_string_lossy().contains(['\\', ':']) {
        return Err(ArchiveError::UnsafeEntry);
    }
    let mut depth = path.parent().map_or(0, |p| p.components().count());
    for part in target.components() {
        match part {
            Component::Normal(_) => depth += 1,
            Component::CurDir => (),
            Component::ParentDir if depth > 0 => depth -= 1,
            _ => return Err(ArchiveError::UnsafeEntry),
        }
    }
    Ok(())
}

/// Server packs use a separate bound; the Java runtime extraction limit stays unchanged.
pub fn extract_server_pack(source: &Path, destination: &Path) -> Result<(), ArchiveError> {
    fs::create_dir(destination)?;
    extract_zip(source, destination, 8 * 1024 * 1024 * 1024)
}
fn extract_zip(source: &Path, root: &Path, max_bytes: u64) -> Result<(), ArchiveError> {
    let mut archive = zip::ZipArchive::new(File::open(source)?)?;
    if archive.len() > MAX_ENTRIES {
        return Err(ArchiveError::Limit);
    }
    let mut total = 0_u64;
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i)?;
        let path = PathBuf::from(entry.name());
        safe_path(&path)?;
        if entry.unix_mode().is_some_and(|m| m & 0o170000 == 0o120000) {
            return Err(ArchiveError::UnsafeEntry);
        }
        let destination = root.join(path);
        if entry.is_dir() {
            fs::create_dir_all(destination)?;
        } else {
            let size = entry.size();
            total = total.checked_add(size).ok_or(ArchiveError::Limit)?;
            if total > max_bytes {
                return Err(ArchiveError::Limit);
            }
            copy_file(&mut entry, &destination, size)?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                // Keep executable helpers usable while stripping special permission bits.
                fs::set_permissions(
                    &destination,
                    fs::Permissions::from_mode(0o644 | (entry.unix_mode().unwrap_or(0) & 0o111)),
                )?;
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_traversal_and_cross_platform_paths() {
        for path in ["../escape", "/absolute", "C:/windows", "a\\..\\escape"] {
            assert!(safe_path(Path::new(path)).is_err(), "{path}");
        }
    }
    #[test]
    fn links_must_stay_within_archive() {
        assert!(
            validate_link(
                Path::new("jdk/legal/module/license"),
                Path::new("../../java.base/LICENSE")
            )
            .is_ok()
        );
        assert!(validate_link(Path::new("jdk/link"), Path::new("../../outside")).is_err());
    }
    #[test]
    fn refuses_existing_extraction_root() -> Result<(), Box<dyn std::error::Error>> {
        let dir = tempfile::tempdir()?;
        assert!(extract(Path::new("unused"), dir.path(), ArchiveFormat::TarGz).is_err());
        Ok(())
    }
}
