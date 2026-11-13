use crate::{
    JavaError, major_version,
    platform::{host_arch, host_os},
};
use mcm_core::java::{JavaRuntime, JavaRuntimeId};
use std::{path::Path, process::Stdio, time::Duration};
use tokio::{io::AsyncReadExt, process::Command};
use uuid::Uuid;

/// Probe executable with a bounded output buffer, no shell, and no inherited JVM options.
/// A supplied path is trusted local code: callers must restrict registration to administrators.
pub async fn identify(path: &Path) -> Result<JavaRuntime, JavaError> {
    let path = tokio::fs::canonicalize(path).await?;
    let mut command = Command::new(&path);
    command
        .arg("-version")
        .env_clear()
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    // Windows needs its system directory to find OS libraries. Do not inherit JAVA_TOOL_OPTIONS.
    for key in ["PATH", "SystemRoot", "WINDIR", "TEMP", "TMP"] {
        if let Some(value) = std::env::var_os(key) {
            command.env(key, value);
        }
    }
    let mut child = command.spawn()?;
    let stdout = child.stdout.take().ok_or(JavaError::Verify)?;
    let stderr = child.stderr.take().ok_or(JavaError::Verify)?;
    let probe = async {
        let (out, mut err, status) =
            tokio::try_join!(read_probe(stdout), read_probe(stderr), async {
                child.wait().await.map_err(JavaError::Io)
            })?;
        if !status.success() {
            return Err(JavaError::Verify);
        }
        err.extend_from_slice(&out);
        Ok::<_, JavaError>(String::from_utf8_lossy(&err).into_owned())
    };
    let output = tokio::time::timeout(Duration::from_secs(10), probe)
        .await
        .map_err(|_| JavaError::Timeout)??;
    let full_version = output
        .lines()
        .find_map(|line| {
            let (_, quoted) = line.split_once("version \"")?;
            Some(quoted.split('"').next()?.to_owned())
        })
        .ok_or(JavaError::InvalidVersion)?;
    let home = path
        .parent()
        .and_then(Path::parent)
        .ok_or(JavaError::Verify)?;
    let release = read_release(home).await;
    let vendor = release_field(&release, "IMPLEMENTOR")
        .unwrap_or("unknown")
        .to_string();
    let arch = release_field(&release, "OS_ARCH").unwrap_or(std::env::consts::ARCH);
    let arch = match arch {
        "amd64" | "x86_64" | "x64" => "x64",
        "aarch64" | "arm64" => "aarch64",
        _ => return Err(JavaError::Platform),
    };
    if arch != host_arch()? {
        return Err(JavaError::Platform);
    }
    Ok(JavaRuntime {
        id: JavaRuntimeId(Uuid::new_v4()),
        vendor,
        major: major_version(&full_version)?,
        full_version,
        os: host_os()?.into(),
        arch: arch.into(),
        path,
        managed: false,
        sha256: None,
    })
}

async fn read_release(home: &Path) -> String {
    let path = home.join("release");
    if let Ok(metadata) = tokio::fs::metadata(&path).await
        && metadata.len() <= 65536
    {
        return tokio::fs::read_to_string(path).await.unwrap_or_default();
    }
    String::new()
}

fn release_field<'a>(release: &'a str, key: &str) -> Option<&'a str> {
    release.lines().find_map(|line| {
        let (name, value) = line.split_once('=')?;
        (name == key).then(|| value.trim_matches('"'))
    })
}

async fn read_probe(reader: impl tokio::io::AsyncRead + Unpin) -> Result<Vec<u8>, JavaError> {
    let mut bytes = Vec::new();
    reader.take(65537).read_to_end(&mut bytes).await?;
    if bytes.len() > 65536 {
        return Err(JavaError::Verify);
    }
    Ok(bytes)
}
