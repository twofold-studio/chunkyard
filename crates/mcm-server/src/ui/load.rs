use super::{Asset, Bundle, UiAssets, UiError};
use axum::http::HeaderValue;
use base64::{Engine, engine::general_purpose::STANDARD};
use bytes::Bytes;
use scraper::{Html, Selector};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeSet, HashMap},
    path::Path,
    sync::Arc,
};
use walkdir::WalkDir;
const MAX_BUNDLE: usize = 64 * 1024 * 1024;

pub(super) fn load(root: &Path) -> Result<Option<UiAssets>, UiError> {
    match std::fs::metadata(root) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e.into()),
        Ok(m) if !m.is_dir() => return Err(UiError::Invalid("ui_dir is not a directory")),
        Ok(_) => (),
    }
    let mut files = HashMap::new();
    let mut hashes = BTreeSet::new();
    let scripts = Selector::parse("script:not([src])")
        .map_err(|_| UiError::Invalid("invalid script selector"))?;
    let mut total = 0;
    for entry in WalkDir::new(root)
        .min_depth(1)
        .max_depth(20)
        .follow_links(false)
    {
        let entry = entry.map_err(|_| UiError::Invalid("could not read build directory"))?;
        if entry.file_type().is_symlink() {
            return Err(UiError::Invalid(
                "symlinks are not allowed in the UI bundle",
            ));
        }
        if !entry.file_type().is_file() {
            continue;
        }
        let relative = entry
            .path()
            .strip_prefix(root)
            .map_err(|_| UiError::Invalid("asset path escapes bundle"))?;
        let parts: Vec<_> = relative
            .iter()
            .map(|s| {
                s.to_str()
                    .ok_or(UiError::Invalid("asset path must be Unicode"))
            })
            .collect::<Result<_, _>>()?;
        if parts.iter().any(|part| part.starts_with('.'))
            || relative.extension().is_some_and(|e| e == "map")
        {
            continue;
        }
        let name = parts.join("/");
        let size = entry
            .metadata()
            .map_err(|_| UiError::Invalid("could not read asset metadata"))?
            .len();
        if size > 32 * 1024 * 1024 || files.len() >= 10000 {
            return Err(UiError::Invalid("UI bundle exceeds limits"));
        }
        let data = std::fs::read(entry.path())?;
        total += data.len();
        if total > MAX_BUNDLE {
            return Err(UiError::Invalid("UI bundle exceeds 64 MiB"));
        }
        let mime = mime_guess::from_path(entry.path())
            .first_or_octet_stream()
            .essence_str()
            .to_owned();
        if mime == "text/html" {
            let source =
                std::str::from_utf8(&data).map_err(|_| UiError::Invalid("HTML must be UTF-8"))?;
            for script in Html::parse_document(source).select(&scripts) {
                let content: String = script.text().collect();
                hashes.insert(format!(
                    "'sha256-{}'",
                    STANDARD.encode(Sha256::digest(content.as_bytes()))
                ));
            }
        }
        let etag = HeaderValue::from_str(&format!("\"{:x}\"", Sha256::digest(&data)))
            .map_err(|_| UiError::Invalid("invalid asset digest"))?;
        files.insert(
            name.clone(),
            Asset {
                data: Bytes::from(data),
                mime,
                etag,
                immutable: name.starts_with("_app/immutable/"),
            },
        );
    }
    if !files.contains_key("200.html") {
        return Err(UiError::Invalid(
            "expected SvelteKit build with 200.html fallback; run pnpm --dir web build",
        ));
    }
    let policy = format!(
        "default-src 'none'; script-src 'self' {}; script-src-attr 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; worker-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'",
        hashes.into_iter().collect::<Vec<_>>().join(" ")
    );
    if policy.len() > 16384 {
        return Err(UiError::Invalid("too many inline scripts for CSP"));
    }
    let csp = HeaderValue::from_str(&policy).map_err(|_| UiError::Invalid("invalid page CSP"))?;
    Ok(Some(UiAssets {
        bundle: Arc::new(Bundle { files, csp }),
    }))
}
