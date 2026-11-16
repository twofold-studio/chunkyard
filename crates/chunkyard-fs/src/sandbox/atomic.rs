//! Staged writes retain cleanup, durability and no-overwrite guarantees.
use super::{
    Sandbox,
    access::{entry_for, hash, metadata_optional, text},
};
use cap_fs_ext::{FollowSymlinks, OpenOptionsFollowExt};
use cap_std::fs::{Dir, OpenOptions};
use chunkyard_core::files::*;
use std::io::{Read, Write};
use uuid::Uuid;

impl Sandbox {
    pub fn save(&self, path: String, request: WriteContent) -> Result<SavedFile, FileError> {
        let (dir, name) = self.parent(&path, true)?;
        if request.content.len() as u64 > TEXT_LIMIT {
            return Err(FileError::TooLarge);
        }
        if request.content.contains('\0') {
            return Err(FileError::Binary);
        }
        let current = metadata_optional(&dir, &name)?;
        match (&request.etag, current) {
            (None, Some(_)) => return Err(FileError::Conflict),
            (Some(expected), Some(_)) => {
                if &hash(text(&dir, &name)?.as_bytes()) != expected {
                    return Err(FileError::Conflict);
                }
            }
            (Some(_), None) => return Err(FileError::Conflict),
            (None, None) => (),
        }
        let bytes = request.content.as_bytes();
        write_atomic(
            &dir,
            &name,
            request.etag.is_some(),
            &mut &bytes[..],
            TEXT_LIMIT,
        )?;
        Ok(SavedFile {
            path,
            size: bytes.len() as u64,
            etag: hash(bytes),
        })
    }
    pub fn upload(
        &self,
        path: String,
        overwrite: bool,
        mut source: Upload,
    ) -> Result<FileEntry, FileError> {
        let (dir, name) = self.parent(&path, true)?;
        write_atomic(&dir, &name, overwrite, &mut source, UPLOAD_LIMIT)?;
        entry_for(&dir, &name, path)
    }
}

struct Staged<'a> {
    dir: &'a Dir,
    name: String,
}
impl Drop for Staged<'_> {
    fn drop(&mut self) {
        let _ = self.dir.remove_file(&self.name);
    }
}

pub(super) fn write_atomic(
    dir: &Dir,
    name: &str,
    overwrite: bool,
    source: &mut dyn Read,
    limit: u64,
) -> Result<(), FileError> {
    let old = metadata_optional(dir, name)?;
    if let Some(meta) = &old {
        if !overwrite {
            return Err(FileError::Exists);
        }
        if meta.is_symlink() {
            return Err(FileError::Symlink);
        }
        if !meta.is_file() {
            return Err(FileError::Path);
        }
    }
    let staged = Staged {
        dir,
        name: format!(".chunkyard-file-{}", Uuid::new_v4()),
    };
    let mut file = dir.open_with(
        &staged.name,
        OpenOptions::new()
            .write(true)
            .create_new(true)
            .follow(FollowSymlinks::No),
    )?;
    let copied = std::io::copy(&mut source.take(limit + 1), &mut file)?;
    if copied > limit {
        return Err(FileError::TooLarge);
    }
    if let Some(meta) = old {
        file.set_permissions(meta.permissions())?;
    }
    file.flush()?;
    file.sync_all()?;
    drop(file);
    if overwrite {
        dir.rename(&staged.name, dir, name)?;
    } else {
        dir.hard_link(&staged.name, dir, name)?;
    }
    Ok(())
}
