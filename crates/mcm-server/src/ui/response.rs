use super::Asset;
use axum::{
    body::Body,
    http::{HeaderMap, HeaderValue, Method, StatusCode},
    response::{IntoResponse, Response},
};

pub(super) fn normalized_path(path: &str) -> Result<String, ()> {
    let decoded = percent_encoding::percent_decode_str(path)
        .decode_utf8()
        .map_err(|_| ())?;
    if decoded.contains(['\\', '\0'])
        || decoded
            .split('/')
            .any(|s| s == ".." || s == "." || s.starts_with('.'))
    {
        return Err(());
    }
    Ok(decoded.trim_start_matches('/').into())
}
pub(super) fn is_navigation(path: &str, headers: &HeaderMap) -> bool {
    if path == "api"
        || path.starts_with("api/")
        || path.starts_with("_app/")
        || std::path::Path::new(path).extension().is_some()
    {
        return false;
    }
    headers.get("accept").is_none_or(|value| {
        value
            .to_str()
            .is_ok_and(|v| v.contains("text/html") || v.contains("*/*"))
    })
}
pub(super) fn asset(
    asset: &Asset,
    csp: &HeaderValue,
    method: &Method,
    headers: &HeaderMap,
) -> Response {
    let html = asset.mime == "text/html";
    let matches = !html
        && headers
            .get("if-none-match")
            .and_then(|v| v.to_str().ok())
            .is_some_and(|value| {
                value.split(',').any(|v| {
                    let v = v.trim().strip_prefix("W/").unwrap_or(v.trim());
                    v == "*" || v.as_bytes() == asset.etag.as_bytes()
                })
            });
    let body = if method == Method::HEAD || matches {
        Body::empty()
    } else {
        Body::from(asset.data.clone())
    };
    let mut response = Response::new(body);
    *response.status_mut() = if matches {
        StatusCode::NOT_MODIFIED
    } else {
        StatusCode::OK
    };
    let headers = response.headers_mut();
    if let Ok(mime) = HeaderValue::from_str(&asset.mime) {
        headers.insert("content-type", mime);
    }
    headers.insert(
        "cache-control",
        HeaderValue::from_static(if html {
            "no-store"
        } else if asset.immutable {
            "public, max-age=31536000, immutable"
        } else {
            "no-cache"
        }),
    );
    if html {
        headers.insert("content-security-policy", csp.clone());
    } else {
        headers.insert("etag", asset.etag.clone());
    }
    if !matches && let Ok(length) = HeaderValue::from_str(&asset.data.len().to_string()) {
        headers.insert("content-length", length);
    }
    response
}
pub(super) fn not_found() -> Response {
    StatusCode::NOT_FOUND.into_response()
}
pub(super) fn method_not_allowed() -> Response {
    let mut response = StatusCode::METHOD_NOT_ALLOWED.into_response();
    response
        .headers_mut()
        .insert("allow", HeaderValue::from_static("GET, HEAD"));
    response
}
