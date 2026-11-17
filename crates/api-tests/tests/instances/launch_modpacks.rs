use crate::common::TestApp;
use serde_json::{Value, json};
type Result<T = ()> = std::result::Result<T, Box<dyn std::error::Error>>;
async fn job(app: &TestApp, body: Value) -> Result<Value> {
    let id = body["job"]["id"].as_str().ok_or("id")?;
    for _ in 0..500 {
        let j: Value = app
            .client
            .get(format!("{}/api/v1/jobs/{id}", app.base))
            .send()
            .await?
            .json()
            .await?;
        if j["state"] == "succeeded" || j["state"] == "failed" {
            return Ok(j);
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    Err("job timeout".into())
}
fn patch(app: &TestApp, id: &str, body: Value) -> reqwest::RequestBuilder {
    app.client
        .patch(format!("{}/api/v1/servers/{id}/launch", app.base))
        .header("Origin", &app.base)
        .header("X-MCM-CSRF", "1")
        .json(&body)
}
#[tokio::test]
async fn launch_profiles_are_validated_stopped_only_and_keep_explicit_image_policy() -> Result {
    let app = TestApp::with_auth(false).await?;
    let created: Value = app
        .post("/api/v1/servers")
        .json(&json!({"name":"Launch","acceptEula":true}))
        .send()
        .await?
        .json()
        .await?;
    let id = created["server"]["id"].as_str().ok_or("id")?;
    let profile = json!({"mode":"args","path":"libraries/unix_args.txt","javaMajor":17,"jvmArgs":["-Dfixture=true"],"args":[]});
    let saved: Value = patch(&app, id, json!({"profile":profile,"dockerImage":null}))
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    assert_eq!(saved["server"]["dockerImage"], "eclipse-temurin:17-jre");
    assert_eq!(saved["server"]["autoJava"], true);
    let settings: Value = app
        .client
        .get(format!("{}/api/v1/servers/{id}/launch", app.base))
        .send()
        .await?
        .json()
        .await?;
    assert_eq!(settings["overridden"], true);
    assert_eq!(settings["current"]["path"], "libraries/unix_args.txt");
    let failed = job(
        &app,
        app.post(&format!("/api/v1/servers/{id}/start"))
            .send()
            .await?
            .json()
            .await?,
    )
    .await?;
    assert_eq!(failed["error"]["code"], "server.launch_missing");
    for path in ["../escape.txt", "/tmp/file.txt", "C:\\file.txt"] {
        let mut invalid = profile.clone();
        invalid["path"] = json!(path);
        assert_eq!(
            patch(&app, id, json!({"profile":invalid}))
                .send()
                .await?
                .status(),
            422
        );
    }
    let dir = app.directory.path().join("servers").join(id);
    std::fs::create_dir_all(dir.join("libraries"))?;
    std::fs::write(dir.join("libraries/unix_args.txt"), "fixture")?;
    assert_eq!(
        job(
            &app,
            app.post(&format!("/api/v1/servers/{id}/start"))
                .send()
                .await?
                .json()
                .await?
        )
        .await?["state"],
        "succeeded"
    );
    assert_eq!(
        patch(&app, id, json!({"profile":null}))
            .send()
            .await?
            .status(),
        409
    );
    assert_eq!(
        job(
            &app,
            app.post(&format!("/api/v1/servers/{id}/stop"))
                .send()
                .await?
                .json()
                .await?
        )
        .await?["state"],
        "succeeded"
    );
    assert_eq!(
        patch(
            &app,
            id,
            json!({"profile":null,"dockerImage":"example/custom:21"})
        )
        .send()
        .await?
        .status(),
        200
    );
    let settings: Value = app
        .client
        .get(format!("{}/api/v1/servers/{id}/launch", app.base))
        .send()
        .await?
        .json()
        .await?;
    assert_eq!(settings["overridden"], false);
    assert_eq!(settings["autoJava"], false);
    app.close().await
}

#[tokio::test]
async fn existing_custom_jar_path_normalization_keeps_its_launch_behavior() -> Result {
    let app = TestApp::with_auth(false).await?;
    let response: Value = app
        .post("/api/v1/servers")
        .json(&json!({"name":"Legacy custom path","jar":"folder/./server.jar","acceptEula":true}))
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    let id = response["server"]["id"].as_str().ok_or("id")?;
    let root = app.directory.path().join("servers").join(id).join("folder");
    std::fs::create_dir(&root)?;
    std::fs::write(root.join("server.jar"), "fixture")?;
    let started = job(
        &app,
        app.post(&format!("/api/v1/servers/{id}/start"))
            .send()
            .await?
            .json()
            .await?,
    )
    .await?;
    assert_eq!(started["state"], "succeeded", "{started}");
    app.close().await
}
#[tokio::test]
async fn server_pack_publication_preserves_eula_and_owner_properties_and_refuses_collisions()
-> Result {
    let app = TestApp::with_auth(false).await?;
    let created: Value = app
        .post("/api/v1/servers")
        .json(&json!({"name":"Pack","software":{"type":"curseforge","projectId":1,"fileId":2}}))
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    let id = created["server"]["id"].as_str().ok_or("id")?;
    let url = format!("{}/api/v1/servers/{id}/properties", app.base);
    let properties: Value = app.client.get(&url).send().await?.json().await?;
    app.client
        .put(&url)
        .header("Origin", &app.base)
        .header("X-MCM-CSRF", "1")
        .json(&json!({"etag":properties["etag"],"content":"motd=owner edit\nonline-mode=true\n"}))
        .send()
        .await?
        .error_for_status()?;
    let installed = job(
        &app,
        app.post(&format!("/api/v1/servers/{id}/install"))
            .json(&json!({"minecraftVersion":"1.20.1","javaMajor":21}))
            .send()
            .await?
            .json()
            .await?,
    )
    .await?;
    assert_eq!(installed["state"], "succeeded", "{installed}");
    let dir = app.directory.path().join("servers").join(id);
    assert!(dir.join("mods/mod.jar").is_file());
    assert_eq!(
        std::fs::read_to_string(dir.join("eula.txt"))?,
        "eula=false\n"
    );
    let props: Value = app.client.get(&url).send().await?.json().await?;
    let content = props["content"].as_str().ok_or("content")?;
    assert!(content.contains("enable-command-block=true"));
    assert!(content.rfind("motd=owner edit") > content.rfind("motd=pack default"));
    assert_eq!(
        installed["result"]["server"]["dockerImage"],
        "eclipse-temurin:21-jre"
    );
    let second: Value = app
        .post("/api/v1/servers")
        .json(&json!({"name":"Conflict","software":{"type":"curseforge","projectId":1,"fileId":2}}))
        .send()
        .await?
        .json()
        .await?;
    let id = second["server"]["id"].as_str().ok_or("id")?;
    let root = app.directory.path().join("servers").join(id);
    std::fs::create_dir(root.join("mods"))?;
    std::fs::write(root.join("mods/owner.jar"), "keep")?;
    let failed = job(
        &app,
        app.post(&format!("/api/v1/servers/{id}/install"))
            .send()
            .await?
            .json()
            .await?,
    )
    .await?;
    assert_eq!(failed["error"]["code"], "software.files_conflict");
    assert_eq!(
        std::fs::read_to_string(root.join("mods/owner.jar"))?,
        "keep"
    );
    assert!(!root.join("fixture.jar").exists());
    app.close().await
}
