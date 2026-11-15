/// Serve the versioned contract without runtime parsing or a CDN dependency.
pub(crate) async fn document() -> impl axum::response::IntoResponse {
    (
        [(axum::http::header::CONTENT_TYPE, "application/json")],
        include_str!("openapi.json"),
    )
}
