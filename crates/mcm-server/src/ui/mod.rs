//! Immutable startup-loaded SPA assets. Runtime server files never share this root.
mod load;
mod response;
use axum::{
    Router,
    body::Body,
    extract::Request,
    http::{HeaderValue, Method},
};
use bytes::Bytes;
use mcm_api::AppState;
use std::{collections::HashMap, path::Path, sync::Arc};

struct Asset {
    data: Bytes,
    mime: String,
    etag: HeaderValue,
    immutable: bool,
}
struct Bundle {
    files: HashMap<String, Asset>,
    csp: HeaderValue,
}
#[derive(Clone)]
pub struct UiAssets {
    bundle: Arc<Bundle>,
}
#[derive(Debug, thiserror::Error)]
pub enum UiError {
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error("invalid UI bundle: {0}")]
    Invalid(&'static str),
    #[error(transparent)]
    Task(#[from] tokio::task::JoinError),
}
impl UiAssets {
    /// None means the build directory doesn't exist. An existing malformed bundle
    /// fails startup instead of publishing a broken page or a source directory.
    pub fn load(root: &Path) -> Result<Option<Self>, UiError> {
        load::load(root, None)
    }
    async fn serve(&self, request: Request) -> axum::response::Response {
        let path = request.uri().path();
        let method = request.method();
        if !matches!(*method, Method::GET | Method::HEAD) {
            return response::method_not_allowed();
        }
        let Ok(path) = response::normalized_path(path) else {
            return response::not_found();
        };
        let asset = self.bundle.files.get(&path);
        let asset = match asset {
            Some(asset) => asset,
            None if response::is_navigation(&path, request.headers()) => {
                match self.bundle.files.get("200.html") {
                    Some(asset) => asset,
                    None => return response::not_found(),
                }
            }
            None => return response::not_found(),
        };
        response::asset(asset, &self.bundle.csp, method, request.headers())
    }
}
/// Compose the SPA fallback with API routes before applying shared security.
pub async fn router(state: AppState, directory: Option<&Path>) -> Result<Router, UiError> {
    let directory = directory.map(Path::to_path_buf);
    let origin = state.origin.clone();
    let assets = tokio::task::spawn_blocking(move || {
        directory
            .as_deref()
            .map(|root| load::load(root, Some(&origin)))
            .transpose()
            .map(Option::flatten)
    })
    .await??;
    let mut router = mcm_api::routes(state.clone());
    if let Some(assets) = assets {
        tracing::info!("Serving the built frontend on the API origin");
        router = router.fallback(move |request: Request<Body>| {
            let assets = assets.clone();
            async move { assets.serve(request).await }
        });
    } else {
        tracing::info!("Frontend build not found or disabled; serving API only");
    }
    Ok(mcm_api::secure_router(router, state))
}
