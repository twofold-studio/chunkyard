//! File access through directory capabilities; user paths never become ambient paths.
#[cfg(unix)]
use cap_fs_ext::OpenOptionsSyncExt;
use cap_fs_ext::{DirExt, FollowSymlinks, OpenOptionsFollowExt};
use cap_std::fs::{Dir, Metadata, OpenOptions};
use chunkyard_core::files::*;
use sha2::{Digest, Sha256};
use std::{
    io::{Read, Write},
    path::Path,
};
use time::{OffsetDateTime, format_description::well_known::Rfc3339};
use uuid::Uuid;

const ENTRY_LIMIT: usize = 5000;
const COPY_LIMIT: u64 = 512 * 1024 * 1024;

pub struct Sandbox {
    root: Dir,
}

fn validate(path: &str, root: bool, write: bool) -> Result<(), FileError> {
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
    fn directory(&self, path: &str) -> Result<Dir, FileError> {
        let mut dir = self.root.try_clone()?;
        for component in path.split('/').filter(|s| !s.is_empty()) {
            dir = nofollow_dir(&dir, component)?;
        }
        Ok(dir)
    }
    fn parent(&self, path: &str, write: bool) -> Result<(Dir, String), FileError> {
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
    pub fn mkdir(&self, path: String) -> Result<FileEntry, FileError> {
        let (dir, name) = self.parent(&path, true)?;
        dir.create_dir(&name)?;
        entry_for(&dir, &name, path)
    }
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

fn join(parent: &str, name: &str) -> String {
    if parent.is_empty() {
        name.to_owned()
    } else {
        format!("{parent}/{name}")
    }
}
fn nofollow_dir(dir: &Dir, name: &str) -> Result<Dir, FileError> {
    if dir.symlink_metadata(name)?.is_symlink() {
        return Err(FileError::Symlink);
    }
    Ok(dir.open_dir_nofollow(name)?)
}
fn metadata_optional(dir: &Dir, name: &str) -> Result<Option<Metadata>, FileError> {
    match dir.symlink_metadata(name) {
        Ok(metadata) => Ok(Some(metadata)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.into()),
    }
}
fn regular(dir: &Dir, name: &str) -> Result<cap_std::fs::File, FileError> {
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
fn text(dir: &Dir, name: &str) -> Result<String, FileError> {
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
fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn entry_for(dir: &Dir, name: &str, path: String) -> Result<FileEntry, FileError> {
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

struct Staged<'a> {
    dir: &'a Dir,
    name: String,
}
impl Drop for Staged<'_> {
    fn drop(&mut self) {
        let _ = self.dir.remove_file(&self.name);
    }
}

fn write_atomic(
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
