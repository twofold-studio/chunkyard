use crate::common::TestApp;
use serde_json::{Value, json};
use std::io::Cursor;
type Result<T = ()> = std::result::Result<T, Box<dyn std::error::Error>>;

fn png(width: u32, height: u32) -> Result<Vec<u8>> {
    let mut bytes = Cursor::new(Vec::new());
    image::RgbaImage::new(width, height).write_to(&mut bytes, image::ImageFormat::Png)?;
    Ok(bytes.into_inner())
}

#[tokio::test]
async fn custom_icons_are_normalized_persisted_and_independent_of_game_files() -> Result {
    let app = TestApp::with_auth(false).await?;
    let created: Value = app
        .post("/api/v1/servers")
        .json(&json!({"name":"Icon", "acceptEula":true}))
        .send()
        .await?
        .json()
        .await?;
    let id = created["server"]["id"].as_str().ok_or("id")?;
    // The fake runtime executes no Java or Minecraft; test edits while marked running.
    tokio::fs::write(
        app.directory
            .path()
            .join("servers")
            .join(id)
            .join("server.jar"),
        b"fixture",
    )
    .await?;
    app.backend.state.servers.start(id).await?;
    let url = format!("{}/api/v1/servers/{id}/icon", app.base);
    assert_eq!(app.client.get(&url).send().await?.status(), 404);
    assert_eq!(
        app.client
            .put(&url)
            .body(png(16, 16)?)
            .send()
            .await?
            .status(),
        403
    );
    let response = app
        .client
        .put(&url)
        .header("Origin", &app.base)
        .header("X-MCM-CSRF", "1")
        .header("Content-Type", "image/png")
        .body(png(512, 128)?)
        .send()
        .await?;
    assert_eq!(response.status(), 200);
    let saved: Value = response.json().await?;
    assert_eq!(saved["server"]["icon"]["source"], "custom");
    let initial = saved["server"]["icon"]["url"].clone();
    let response = app.client.get(&url).send().await?;
    assert_eq!(response.headers()["content-type"], "image/png");
    assert_eq!(response.headers()["x-content-type-options"], "nosniff");
    let image = image::load_from_memory(&response.bytes().await?)?;
    assert_eq!((image.width(), image.height()), (256, 64));
    let server: Value = app
        .client
        .get(format!("{}/api/v1/servers/{id}", app.base))
        .send()
        .await?
        .json()
        .await?;
    assert_eq!(server["icon"]["url"], initial);
    assert!(
        !app.directory
            .path()
            .join("servers")
            .join(id)
            .join("server-icon.png")
            .exists()
    );
    let response = app
        .client
        .delete(&url)
        .header("Origin", &app.base)
        .header("X-MCM-CSRF", "1")
        .send()
        .await?;
    assert_eq!(response.status(), 200);
    assert!(response.json::<Value>().await?["server"]["icon"].is_null());
    assert_eq!(app.client.get(&url).send().await?.status(), 404);
    app.close().await
}

#[tokio::test]
async fn invalid_icons_never_replace_a_saved_icon() -> Result {
    let app = TestApp::with_auth(false).await?;
    let created: Value = app
        .post("/api/v1/servers")
        .json(&json!({"name":"Icon"}))
        .send()
        .await?
        .json()
        .await?;
    let id = created["server"]["id"].as_str().ok_or("id")?;
    let url = format!("{}/api/v1/servers/{id}/icon", app.base);
    let valid = png(2, 2)?;
    assert_eq!(
        app.client
            .put(&url)
            .header("Origin", &app.base)
            .header("X-MCM-CSRF", "1")
            .body(valid)
            .send()
            .await?
            .status(),
        200
    );
    let before = app.client.get(&url).send().await?.bytes().await?;
    for (bytes, status, code) in [
        (b"<svg></svg>".to_vec(), 415, "icons.unsupported"),
        (vec![0; 2 * 1024 * 1024 + 1], 413, "icons.too_large"),
        (png(4097, 1)?, 422, "icons.invalid"),
    ] {
        let response = app
            .client
            .put(&url)
            .header("Origin", &app.base)
            .header("X-MCM-CSRF", "1")
            .body(bytes)
            .send()
            .await?;
        assert_eq!(response.status(), status);
        assert_eq!(response.json::<Value>().await?["code"], code);
        assert_eq!(app.client.get(&url).send().await?.bytes().await?, before);
    }
    app.close().await
}
