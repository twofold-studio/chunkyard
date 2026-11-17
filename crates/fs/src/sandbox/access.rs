//! Validated paths and link-free capability access.
use super::{ENTRY_LIMIT, Sandbox};
#[cfg(unix)]
use cap_fs_ext::OpenOptionsSyncExt;
use cap_fs_ext::{DirExt, FollowSymlinks, OpenOptionsFollowExt};
use cap_std::fs::{Dir, Metadata, OpenOptions};
use chunkyard_core::files::*;
use sha2::{Digest, Sha256};
use std::{io::Read, path::Path};
use time::{OffsetDateTime, format_description::well_known::Rfc3339};
use uuid::Uuid;

pub(super) fn validate(path: &str, root: bool, write: bool) -> Result<(), FileError> {
    if path.is_empty() {
        return if root { Ok(()) } else { Err(FileError::Path) };
    }
    if path.len() > 1024 || path.split('/').count() > 32 {
        return Err(FileError::Path);
    }
    for part in path.split('/') {
        if part.is_empty()
            || part == "."
            || part == ".."
            || part.len() > 255
            || part.ends_with(['.', ' '])
            || part.chars().any(|c| {
                c.is_control() || matches!(c, '\\' | ':' | '<' | '>' | '"' | '|' | '?' | '*')
            })
        {
            return Err(FileError::Path);
        }
        let lower = part.to_ascii_lowercase();
        if lower.starts_with(".chunkyard-") {
            return Err(FileError::Protected);
        }
        let base = lower.split('.').next().unwrap_or("");
        if matches!(base, "con" | "prn" | "aux" | "nul")
            || (base.len() == 4
                && (base.starts_with("com") || base.starts_with("lpt"))
                && matches!(base.as_bytes()[3], b'1'..=b'9'))
        {
            return Err(FileError::Path);
        }
    }
    if write && path.eq_ignore_ascii_case("eula.txt") {
        return Err(FileError::Protected);
    }
    Ok(())
}

impl Sandbox {
    pub fn open(root: &Path, id: &str) -> Result<Self, FileError> {
        // Only the configured root is ambient authority; an instance may not be a link.
        let parent = Dir::open_ambient_dir(root, cap_std::ambient_authority())?;
        let canonical = Uuid::parse_str(id)
            .map_err(|_| FileError::Path)?
            .to_string();
        Ok(Self {
            root: nofollow_dir(&parent, &canonical)?,
        })
    }
    pub(super) fn directory(&self, path: &str) -> Result<Dir, FileError> {
        let mut dir = self.root.try_clone()?;
        for component in path.split('/').filter(|s| !s.is_empty()) {
            dir = nofollow_dir(&dir, component)?;
        }
        Ok(dir)
    }
    pub(super) fn parent(&self, path: &str, write: bool) -> Result<(Dir, String), FileError> {
        validate(path, false, write)?;
        let (parent, name) = path.rsplit_once('/').unwrap_or(("", path));
        Ok((self.directory(parent)?, name.to_owned()))
    }
    pub fn list(&self, path: String, can_write: bool) -> Result<FileListing, FileError> {
        validate(&path, true, false)?;
        let dir = self.directory(&path)?;
        let mut entries = Vec::new();
        let mut truncated = false;
        // Bound iteration too, including hidden/non-UTF-8 entries.
        for (index, entry) in dir.entries()?.enumerate() {
            if index >= ENTRY_LIMIT {
                truncated = true;
                break;
            }
            let entry = entry?;
            let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
                truncated = true;
                continue;
            };
            let relative = join(&path, &name);
            if validate(&relative, false, false).is_err() {
                continue;
            }
            entries.push(entry_for(&dir, &name, relative)?);
        }
        entries.sort_by(|a, b| {
            let a_dir = matches!(a.kind, FileKind::Directory);
            let b_dir = matches!(b.kind, FileKind::Directory);
            b_dir.cmp(&a_dir).then_with(|| a.name.cmp(&b.name))
        });
        Ok(FileListing {
            path,
            entries,
            truncated,
            can_write,
        })
    }
    pub fn content(&self, path: String, can_write: bool) -> Result<FileContent, FileError> {
        let (dir, name) = self.parent(&path, false)?;
        let content = text(&dir, &name)?;
        Ok(FileContent {
            read_only: path.eq_ignore_ascii_case("eula.txt"),
            size: content.len() as u64,
            etag: hash(content.as_bytes()),
            content,
            path,
            can_write,
        })
    }
    pub fn download(&self, path: String) -> Result<Download, FileError> {
        let (dir, name) = self.parent(&path, false)?;
        let file = regular(&dir, &name)?;
        let size = file.metadata()?.len();
        Ok(Download {
            file: file.into_std(),
            name,
            size,
        })
    }
    pub fn mkdir(&self, path: String) -> Result<FileEntry, FileError> {
        let (dir, name) = self.parent(&path, true)?;
        dir.create_dir(&name)?;
        entry_for(&dir, &name, path)
    }
    pub fn delete(&self, path: String, recursive: bool) -> Result<(), FileError> {
        let (dir, name) = self.parent(&path, true)?;
        let metadata = dir.symlink_metadata(&name)?;
        if metadata.is_dir() {
            if recursive {
                dir.remove_dir_all(&name)?;
            } else {
                dir.remove_dir(&name)?;
            }
        } else {
            dir.remove_file(&name)?;
        }
        Ok(())
    }
}

pub(super) fn join(parent: &str, name: &str) -> String {
    if parent.is_empty() {
        name.to_owned()
    } else {
        format!("{parent}/{name}")
    }
}
pub(super) fn nofollow_dir(dir: &Dir, name: &str) -> Result<Dir, FileError> {
    if dir.symlink_metadata(name)?.is_symlink() {
        return Err(FileError::Symlink);
    }
    Ok(dir.open_dir_nofollow(name)?)
}
pub(super) fn metadata_optional(dir: &Dir, name: &str) -> Result<Option<Metadata>, FileError> {
    match dir.symlink_metadata(name) {
        Ok(metadata) => Ok(Some(metadata)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.into()),
    }
}
pub(super) fn regular(dir: &Dir, name: &str) -> Result<cap_std::fs::File, FileError> {
    let metadata = dir.symlink_metadata(name)?;
    if metadata.is_symlink() {
        return Err(FileError::Symlink);
    }
    if !metadata.is_file() {
        return Err(FileError::Path);
    }
    let mut options = OpenOptions::new();
    options.read(true).follow(FollowSymlinks::No);
    #[cfg(unix)]
    options.nonblock(true);
    let file = dir.open_with(name, &options)?;
    if !file.metadata()?.is_file() {
        return Err(FileError::Path);
    }
    Ok(file)
}
pub(super) fn text(dir: &Dir, name: &str) -> Result<String, FileError> {
    let file = regular(dir, name)?;
    if file.metadata()?.len() > TEXT_LIMIT {
        return Err(FileError::TooLarge);
    }
    let mut bytes = Vec::new();
    file.take(TEXT_LIMIT + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > TEXT_LIMIT {
        return Err(FileError::TooLarge);
    }
    if bytes.contains(&0) {
        return Err(FileError::Binary);
    }
    String::from_utf8(bytes).map_err(|_| FileError::Binary)
}
pub(super) fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
pub(super) fn entry_for(dir: &Dir, name: &str, path: String) -> Result<FileEntry, FileError> {
    let meta = dir.symlink_metadata(name)?;
    let kind = if meta.is_symlink() {
        FileKind::Symlink
    } else if meta.is_dir() {
        FileKind::Directory
    } else if meta.is_file() {
        FileKind::File
    } else {
        FileKind::Other
    };
    Ok(FileEntry {
        name: name.to_owned(),
        read_only: path.eq_ignore_ascii_case("eula.txt")
            || matches!(kind, FileKind::Symlink | FileKind::Other),
        path,
        kind,
        size: meta.len(),
        modified_at: meta
            .modified()
            .ok()
            .and_then(|t| OffsetDateTime::from(t.into_std()).format(&Rfc3339).ok()),
    })
}
