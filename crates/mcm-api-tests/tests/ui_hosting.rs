mod common;
use base64::{Engine, engine::general_purpose::STANDARD};
use common::TestApp;
use serde_json::Value;
use sha2::{Digest, Sha256};
type Result<T = ()> = std::result::Result<T, Box<dyn std::error::Error>>;
#[tokio::test]
async fn root_and_deep_links_serve_the_same_html_with_a_hashed_bootstrap_policy() -> Result {
    let app = TestApp::with_ui().await?;
    for path in ["/", "/servers", "/servers/new", "/login", "/java"] {
        let response = app.client.get(format!("{}{path}", app.base)).send().await?;
        assert_eq!(response.status(), 200);
        assert_eq!(response.headers()["content-type"], "text/html");
        assert_eq!(response.headers()["cache-control"], "no-store");
        let csp = response.headers()["content-security-policy"].to_str()?;
        let hash = format!(
            "'sha256-{}'",
            STANDARD.encode(Sha256::digest(b"window.test=1;"))
        );
        assert!(csp.contains(&hash));
        assert!(csp.contains("script-src 'self'"));
        assert!(!csp.contains("unsafe-eval"));
        assert!(response.text().await?.contains("window.test=1"));
    }
    app.close().await
}
#[tokio::test]
async fn immutable_assets_have_types_etags_and_correct_head_and_revalidation_responses() -> Result {
    let app = TestApp::with_ui().await?;
    let url = format!("{}/_app/immutable/test.ABC.js", app.base);
    let response = app.client.get(&url).send().await?;
    assert_eq!(response.status(), 200);
    assert!(
        response.headers()["content-type"]
            .to_str()?
            .contains("javascript")
    );
    assert!(
        response.headers()["cache-control"]
            .to_str()?
            .contains("immutable")
    );
    assert!(
        response.headers()["content-security-policy"]
            .to_str()?
            .contains("default-src 'none'")
    );
    let etag = response.headers()["etag"].to_str()?.to_owned();
    let length = response.headers()["content-length"].to_str()?.to_owned();
    let revalidated = app
        .client
        .get(&url)
        .header("if-none-match", etag)
        .send()
        .await?;
    assert_eq!(revalidated.status(), 304);
    assert!(revalidated.bytes().await?.is_empty());
    let head = app.client.head(&url).send().await?;
    assert_eq!(head.status(), 200);
    assert_eq!(head.headers()["content-length"], length);
    assert!(head.bytes().await?.is_empty());
    app.close().await
}
#[tokio::test]
async fn missing_assets_and_api_routes_never_fall_back_to_html() -> Result {
    let app = TestApp::with_ui().await?;
    for path in [
        "/_app/immutable/missing.js",
        "/_app/missing",
        "/missing.css",
        "/%2e%2e%2fsecret",
        "/.env",
    ] {
        let response = app.client.get(format!("{}{path}", app.base)).send().await?;
        assert_eq!(response.status(), 404, "{path}");
        assert!(
            !response
                .headers()
                .get("content-type")
                .is_some_and(|v| v == "text/html")
        );
    }
    for path in ["/api", "/api/", "/api/v1/missing", "/api/v99/unknown"] {
        let response = app.client.get(format!("{}{path}", app.base)).send().await?;
        assert_eq!(response.status(), 404);
        assert_eq!(
            response.headers()["content-type"],
            "application/problem+json"
        );
        assert_eq!(response.json::<Value>().await?["code"], "not_found");
    }
    assert_eq!(
        app.client
            .get(format!("{}/api/v1/setup/status", app.base))
            .send()
            .await?
            .status(),
        200
    );
    app.close().await
}
#[tokio::test]
async fn static_pages_share_host_origin_and_method_checks() -> Result {
    let app = TestApp::with_ui().await?;
    assert_eq!(
        app.client
            .get(&app.base)
            .header("Host", "evil.example")
            .send()
            .await?
            .status(),
        400
    );
    assert_eq!(
        app.client
            .get(&app.base)
            .header("Origin", "https://evil.example")
            .send()
            .await?
            .status(),
        403
    );
    assert_eq!(app.post("/servers").send().await?.status(), 405);
    assert_eq!(
        app.client
            .post(format!("{}/servers", app.base))
            .send()
            .await?
            .status(),
        403
    );
    app.close().await
}
#[test]
fn invalid_bundle_is_rejected_and_missing_bundle_keeps_api_only_mode() -> Result {
    let root = tempfile::tempdir()?;
    assert!(mcm_server::ui::UiAssets::load(&root.path().join("missing"))?.is_none());
    assert!(mcm_server::ui::UiAssets::load(root.path()).is_err());
    #[cfg(unix)]
    {
        std::fs::write(root.path().join("200.html"), "<html></html>")?;
        std::os::unix::fs::symlink("/etc/passwd", root.path().join("secret"))?;
        assert!(mcm_server::ui::UiAssets::load(root.path()).is_err());
    }
    Ok(())
}
