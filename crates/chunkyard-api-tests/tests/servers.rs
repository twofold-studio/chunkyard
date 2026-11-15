mod common;
use common::TestApp;
use serde_json::{Value, json};
type Result<T = ()> = std::result::Result<T, Box<dyn std::error::Error>>;

#[tokio::test]
async fn create_and_control_a_server_through_authenticated_jobs() -> Result {
    let app = TestApp::new().await?;
    assert_eq!(
        app.client
            .get(format!("{}/api/v1/servers", app.base))
            .send()
            .await?
            .status(),
        503
    );
    app.setup().await?;
    let response = app
        .post("/api/v1/servers")
        .json(&json!({"name":"Survival", "port":25565, "acceptEula":true}))
        .send()
        .await?;
    assert_eq!(response.status(), 201);
    assert!(response.headers().contains_key("location"));
    let created: Value = response.json().await?;
    let id = created["server"]["id"].as_str().ok_or("missing ID")?;
    let directory = created["server"]["directory"]
        .as_str()
        .ok_or("missing directory")?;
    std::fs::write(
        std::path::Path::new(directory).join("server.jar"),
        "fixture",
    )?;
    for (action, expected) in [
        ("start", "running"),
        ("restart", "running"),
        ("stop", "stopped"),
        ("start", "running"),
        ("kill", "stopped"),
    ] {
        let response = app
            .post(&format!("/api/v1/servers/{id}/{action}"))
            .send()
            .await?;
        assert_eq!(response.status(), 202);
        let pending: Value = response.json().await?;
        assert_eq!(pending["job"]["serverId"], id);
        let job = wait(&app, pending["job"]["id"].as_str().ok_or("missing job")?).await?;
        assert_eq!(job["state"], "succeeded", "{job}");
        assert_eq!(job["result"]["server"]["status"]["state"], expected);
        if action == "start" {
            assert_eq!(
                app.post(&format!("/api/v1/servers/{id}/console/commands"))
                    .json(&json!({"line":"say hi"}))
                    .send()
                    .await?
                    .status(),
                204
            );
        }
    }
    let logs: Value = app
        .client
        .get(format!("{}/api/v1/servers/{id}/console?tail=20", app.base))
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    assert!(
        logs["items"][0]["text"]
            .as_str()
            .is_some_and(|text| text.contains("Done"))
    );
    let list: Value = app
        .client
        .get(format!("{}/api/v1/servers", app.base))
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    assert_eq!(list["items"].as_array().map(Vec::len), Some(1));
    app.close().await
}
#[tokio::test]
async fn creation_validates_paths_resources_runtime_and_allows_shared_configured_ports() -> Result {
    let app = TestApp::with_auth(false).await?;
    for request in [
        json!({"name":"bad","port":0}),
        json!({"name":"bad","port":25565,"jar":"../secret.jar"}),
        json!({"name":"bad","port":25565,"memoryMinMb":4096,"memoryMaxMb":512}),
        json!({"name":"bad","port":25565,"runtime":"native"}),
        json!({"name":"bad","port":25565,"dockerImage":"image; shell"}),
    ] {
        assert_eq!(
            app.post("/api/v1/servers")
                .json(&request)
                .send()
                .await?
                .status(),
            422
        );
    }
    let valid = json!({"name":"Test","port":25565});
    assert_eq!(
        app.post("/api/v1/servers")
            .json(&valid)
            .send()
            .await?
            .status(),
        201
    );
    assert_eq!(
        app.post("/api/v1/servers")
            .json(&valid)
            .send()
            .await?
            .status(),
        201
    );
    assert_eq!(
        app.post("/api/v1/servers/not-an-id/start")
            .send()
            .await?
            .status(),
        404
    );
    app.close().await
}
#[tokio::test]
async fn start_requires_explicit_eula_and_a_jar_and_commands_reject_multiple_lines() -> Result {
    let app = TestApp::with_auth(false).await?;
    for (port, accepted, code) in [
        (25565, false, "server.eula_required"),
        (25566, true, "server.jar_missing"),
    ] {
        let created: Value = app
            .post("/api/v1/servers")
            .json(&json!({"name":"Test","port":port,"acceptEula":accepted}))
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;
        let id = created["server"]["id"].as_str().ok_or("ID missing")?;
        let pending: Value = app
            .post(&format!("/api/v1/servers/{id}/start"))
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;
        let job = wait(&app, pending["job"]["id"].as_str().ok_or("job ID missing")?).await?;
        assert_eq!(job["error"]["code"], code);
        assert_eq!(
            app.post(&format!("/api/v1/servers/{id}/console/commands"))
                .json(&json!({"line":"say hi\nstop"}))
                .send()
                .await?
                .status(),
            422
        );
    }
    app.close().await
}
#[cfg(unix)]
#[tokio::test]
async fn a_jar_symlink_cannot_escape_the_server_directory() -> Result {
    let app = TestApp::with_auth(false).await?;
    let created: Value = app
        .post("/api/v1/servers")
        .json(&json!({"name":"Test","port":25565,"acceptEula":true}))
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    let id = created["server"]["id"].as_str().ok_or("ID missing")?;
    let outside = app.directory.path().join("outside.jar");
    std::fs::write(&outside, "not a server file")?;
    std::os::unix::fs::symlink(
        outside,
        std::path::Path::new(
            created["server"]["directory"]
                .as_str()
                .ok_or("directory missing")?,
        )
        .join("server.jar"),
    )?;
    let pending: Value = app
        .post(&format!("/api/v1/servers/{id}/start"))
        .send()
        .await?
        .json()
        .await?;
    let job = wait(&app, pending["job"]["id"].as_str().ok_or("job missing")?).await?;
    assert_eq!(job["error"]["code"], "server.jar_missing");
    app.close().await
}
async fn wait(app: &TestApp, id: &str) -> Result<Value> {
    // Allow scheduler/SQLite latency when the full suite also runs password hashing.
    for _ in 0..1000 {
        let job: Value = app
            .client
            .get(format!("{}/api/v1/jobs/{id}", app.base))
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;
        if job["state"] == "succeeded" || job["state"] == "failed" {
            return Ok(job);
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    Err("job did not finish".into())
}

#[tokio::test]
async fn eula_acceptance_can_be_changed_while_stopped_without_following_a_symlink() -> Result {
    let app = TestApp::with_auth(false).await?;
    let created: Value = app
        .post("/api/v1/servers")
        .json(&json!({"name":"Test","port":25565}))
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    let id = created["server"]["id"].as_str().ok_or("ID missing")?;
    let directory = std::path::Path::new(
        created["server"]["directory"]
            .as_str()
            .ok_or("directory missing")?,
    );
    #[cfg(unix)]
    {
        let outside = app.directory.path().join("outside-eula.txt");
        std::fs::write(&outside, "do not change")?;
        std::fs::remove_file(directory.join("eula.txt"))?;
        std::os::unix::fs::symlink(&outside, directory.join("eula.txt"))?;
    }
    let accepted: Value = app
        .post(&format!("/api/v1/servers/{id}/eula"))
        .json(&json!({"accepted":true}))
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    assert_eq!(accepted["server"]["acceptEula"], true);
    assert_eq!(
        std::fs::read_to_string(directory.join("eula.txt"))?,
        "eula=true\n"
    );
    #[cfg(unix)]
    assert_eq!(
        std::fs::read_to_string(app.directory.path().join("outside-eula.txt"))?,
        "do not change"
    );
    std::fs::write(directory.join("server.jar"), "fixture")?;
    let pending: Value = app
        .post(&format!("/api/v1/servers/{id}/start"))
        .send()
        .await?
        .json()
        .await?;
    assert_eq!(
        wait(&app, pending["job"]["id"].as_str().ok_or("job missing")?).await?["state"],
        "succeeded"
    );
    assert_eq!(
        app.post(&format!("/api/v1/servers/{id}/eula"))
            .json(&json!({"accepted":false}))
            .send()
            .await?
            .status(),
        409
    );
    app.close().await
}
