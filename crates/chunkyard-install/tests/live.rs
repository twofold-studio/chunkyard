//! Explicit opt-in upstream contract check: no EULA acceptance or game startup.
use chunkyard_core::software::{Software, SoftwareService};
#[tokio::test]
#[ignore = "downloads real Vanilla and Paper JARs from official upstream services"]
async fn upstream_catalogs_and_verified_jars() -> Result<(), Box<dyn std::error::Error>> {
    let installers = chunkyard_install::Installers::new()?;
    for kind in ["vanilla", "paper"] {
        let versions = installers.versions(kind).await?;
        assert!(versions["items"].as_array().is_some_and(|v| !v.is_empty()));
        assert!(
            versions["items"]
                .as_array()
                .ok_or("versions")?
                .iter()
                .all(|v| v["stable"] == true)
        );
    }
    let builds = installers.builds("paper", "1.21.4").await?;
    let build = builds["items"][0]["id"].as_str().ok_or("build")?.to_owned();
    for software in [
        Software::Vanilla {
            version: "1.21.4".into(),
        },
        Software::Paper {
            version: "1.21.4".into(),
            build: Some(build.clone()),
        },
    ] {
        let dir = tempfile::tempdir()?;
        let launch = installers.prepare(&software, dir.path()).await?;
        assert_eq!(launch.version, "1.21.4");
        assert_eq!(launch.java_major, 21);
        assert!(
            tokio::fs::metadata(dir.path().join(&launch.path))
                .await?
                .len()
                > 1024 * 1024
        );
        if matches!(software, Software::Paper { .. }) {
            assert_eq!(launch.build, Some(build.clone()));
            assert_eq!(launch.checksum.len(), 64)
        } else {
            assert_eq!(launch.checksum.len(), 40)
        }
    }
    Ok(())
}
