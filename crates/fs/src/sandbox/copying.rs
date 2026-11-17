//! Recursive copying shares one byte/entry budget and rolls back failed trees.
use super::{
    ENTRY_LIMIT, Sandbox,
    access::{entry_for, metadata_optional, nofollow_dir, regular, validate},
    atomic::write_atomic,
};
use cap_std::fs::Dir;
use chunkyard_core::files::*;
use std::io::Read;

const COPY_LIMIT: u64 = 512 * 1024 * 1024;

impl Sandbox {
    pub fn transfer(&self, request: Transfer, copy: bool) -> Result<FileEntry, FileError> {
        let (from_dir, from) = self.parent(&request.from, true)?;
        let (to_dir, to) = self.parent(&request.to, true)?;
        if request.to == request.from || request.to.starts_with(&format!("{}/", request.from)) {
            return Err(FileError::Path);
        }
        if metadata_optional(&to_dir, &to)?.is_some() {
            return Err(FileError::Exists);
        }
        let metadata = from_dir.symlink_metadata(&from)?;
        // Links and special files are visible but never copied or moved.
        if metadata.is_symlink() {
            return Err(FileError::Symlink);
        }
        if !metadata.is_file() && !metadata.is_dir() {
            return Err(FileError::Path);
        }
        if copy {
            let mut budget = CopyBudget {
                bytes: COPY_LIMIT,
                entries: ENTRY_LIMIT,
            };
            let depth = request
                .from
                .split('/')
                .count()
                .max(request.to.split('/').count());
            let length = request.from.len().max(request.to.len());
            copy_entry(&from_dir, &from, &to_dir, &to, &mut budget, depth, length)?;
        } else {
            // Requests share the instance lock. No request can overwrite another request's destination.
            from_dir.rename(&from, &to_dir, &to)?;
        }
        entry_for(&to_dir, &to, request.to)
    }
}

struct CopyBudget {
    bytes: u64,
    entries: usize,
}
fn copy_entry(
    from_dir: &Dir,
    from: &str,
    to_dir: &Dir,
    to: &str,
    budget: &mut CopyBudget,
    depth: usize,
    path_length: usize,
) -> Result<(), FileError> {
    if depth > 32 || path_length > 1024 {
        return Err(FileError::TooLarge);
    }
    budget.entries = budget.entries.checked_sub(1).ok_or(FileError::TooLarge)?;
    let metadata = from_dir.symlink_metadata(from)?;
    if metadata.is_symlink() {
        return Err(FileError::Symlink);
    }
    if metadata.is_file() {
        let mut source = regular(from_dir, from)?;
        if metadata.len() > budget.bytes {
            return Err(FileError::TooLarge);
        }
        let limit = budget.bytes;
        // Account from the opened handle and reject growth beyond the remaining budget.
        let mut counter = CountRead {
            source: &mut source,
            count: 0,
        };
        write_atomic(to_dir, to, false, &mut counter, limit)?;
        budget.bytes = budget
            .bytes
            .checked_sub(counter.count)
            .ok_or(FileError::TooLarge)?;
        Ok(())
    } else if metadata.is_dir() {
        let source = nofollow_dir(from_dir, from)?;
        to_dir.create_dir(to)?;
        let result = (|| {
            let target = nofollow_dir(to_dir, to)?;
            for entry in source.entries()? {
                let entry = entry?;
                let name = entry
                    .file_name()
                    .into_string()
                    .map_err(|_| FileError::Path)?;
                validate(&name, false, false)?;
                copy_entry(
                    &source,
                    &name,
                    &target,
                    &name,
                    budget,
                    depth + 1,
                    path_length + 1 + name.len(),
                )?;
            }
            Ok(())
        })();
        if result.is_err() {
            let _ = to_dir.remove_dir_all(to);
        }
        result
    } else {
        Err(FileError::Path)
    }
}
struct CountRead<'a> {
    source: &'a mut dyn Read,
    count: u64,
}
impl Read for CountRead<'_> {
    fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
        let n = self.source.read(buffer)?;
        self.count += n as u64;
        Ok(n)
    }
}
