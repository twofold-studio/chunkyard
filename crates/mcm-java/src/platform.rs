use crate::JavaError;
use std::path::Path;

pub(crate) fn java_name() -> &'static str {
    if cfg!(windows) { "java.exe" } else { "java" }
}

pub(crate) fn host_arch() -> Result<&'static str, JavaError> {
    match std::env::consts::ARCH {
        "x86_64" => Ok("x64"),
        "aarch64" => Ok("aarch64"),
        _ => Err(JavaError::Platform),
    }
}
pub(crate) fn host_os() -> Result<&'static str, JavaError> {
    if cfg!(windows) {
        Ok("windows")
    }
    // Check the host, not the binary's target libc (a musl binary can run on glibc).
    else if cfg!(target_os = "linux") {
        if Path::new("/etc/alpine-release").exists() {
            Ok("alpine-linux")
        } else {
            Ok("linux")
        }
    } else {
        Err(JavaError::Platform)
    }
}
