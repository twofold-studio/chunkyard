//! Managed Minecraft software and resolved launch provenance.
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase", deny_unknown_fields)]
pub enum Software {
    CurseForge {
        #[serde(rename = "projectId")]
        project_id: u64,
        #[serde(rename = "fileId")]
        file_id: u64,
    },
    Vanilla {
        version: String,
    },
    Paper {
        version: String,
        #[serde(default)]
        build: Option<String>,
    },
    Purpur {
        version: String,
        #[serde(default)]
        build: Option<String>,
    },
    Fabric {
        version: String,
        #[serde(rename = "loaderVersion")]
        loader_version: String,
    },
    Forge {
        version: String,
        #[serde(rename = "loaderVersion")]
        loader_version: String,
    },
    NeoForge {
        version: String,
        #[serde(rename = "loaderVersion")]
        loader_version: String,
    },
}
impl Software {
    pub fn validate(&self) -> Result<(), SoftwareError> {
        if let Self::CurseForge {
            project_id,
            file_id,
        } = self
        {
            return if *project_id > 0 && *file_id > 0 {
                Ok(())
            } else {
                Err(SoftwareError::Invalid)
            };
        }
        component(self.version())?;
        if let Self::Fabric { loader_version, .. }
        | Self::Forge { loader_version, .. }
        | Self::NeoForge { loader_version, .. } = self
        {
            component(loader_version)?;
        }
        if let Self::Paper {
            build: Some(build), ..
        }
        | Self::Purpur {
            build: Some(build), ..
        } = self
            && !build
                .parse::<u32>()
                .is_ok_and(|n| n > 0 && n.to_string() == *build)
        {
            return Err(SoftwareError::Invalid);
        }
        Ok(())
    }
    pub fn version(&self) -> &str {
        match self {
            Self::CurseForge { .. } => "curseforge",
            Self::Vanilla { version }
            | Self::Paper { version, .. }
            | Self::Purpur { version, .. }
            | Self::Fabric { version, .. }
            | Self::Forge { version, .. }
            | Self::NeoForge { version, .. } => version,
        }
    }
}
pub fn component(value: &str) -> Result<(), SoftwareError> {
    if value.is_empty()
        || value.len() > 80
        || !value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"._-+".contains(&b))
        || value.starts_with('.')
    {
        return Err(SoftwareError::Invalid);
    }
    Ok(())
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Launch {
    pub path: String,
    pub version: String,
    pub build: Option<String>,
    pub java_major: u16,
    pub checksum: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub profile: Option<LaunchOptions>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub loader: Option<Loader>,
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum LaunchMode {
    Jar,
    Args,
    Script,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LaunchOptions {
    pub mode: LaunchMode,
    #[serde(default)]
    pub jvm_args: Vec<String>,
    #[serde(default)]
    pub args: Vec<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LaunchProfile {
    pub mode: LaunchMode,
    pub path: String,
    pub java_major: u16,
    #[serde(default)]
    pub jvm_args: Vec<String>,
    #[serde(default)]
    pub args: Vec<String>,
}
impl LaunchProfile {
    pub fn validate(&self) -> Result<(), SoftwareError> {
        use std::path::{Component, Path};
        if !(8..=99).contains(&self.java_major)
            || self.path.is_empty()
            || self.path.len() > 512
            || self.path.contains(['\\', ':'])
            || self.path.chars().any(char::is_control)
            || self
                .path
                .split('/')
                .any(|p| p.is_empty() || p == "." || p == "..")
            || Path::new(&self.path)
                .components()
                .any(|p| !matches!(p, Component::Normal(_)))
            || (self.mode == LaunchMode::Script
                && [".bat", ".cmd", ".ps1"]
                    .iter()
                    .any(|suffix| self.path.to_ascii_lowercase().ends_with(suffix)))
            || self.jvm_args.len() + self.args.len() > 128
            || self
                .jvm_args
                .iter()
                .chain(&self.args)
                .any(|s| s.len() > 1024 || s.chars().any(char::is_control))
            || self
                .jvm_args
                .iter()
                .chain(&self.args)
                .map(String::len)
                .sum::<usize>()
                > 32768
        {
            return Err(SoftwareError::Invalid);
        }
        Ok(())
    }
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum LoaderType {
    Forge,
    NeoForge,
    Fabric,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Loader {
    pub r#type: LoaderType,
    pub version: String,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InstallOptions {
    pub minecraft_version: Option<String>,
    pub loader: Option<LoaderType>,
    pub loader_version: Option<String>,
    pub java_major: Option<u16>,
    pub launch: Option<LaunchProfile>,
}
pub struct InstallerCommand {
    pub path: String,
    pub args: Vec<String>,
    pub java_major: u16,
}
pub struct PreparedSoftware {
    pub launch: Launch,
    pub installer: Option<InstallerCommand>,
    pub instance_files: bool,
}
#[derive(Debug, thiserror::Error)]
pub enum SoftwareError {
    #[error("The author has not made this file available for third-party download.")]
    DownloadUnavailable,
    #[error(
        "Could not detect a supported server loader. Supply advanced install settings or select another server release."
    )]
    PackUnsupported,
    #[error(
        "Existing files conflict with the server pack. Move them before retrying installation."
    )]
    FilesConflict,
    #[error("The isolated loader installer failed. Check the install job and resource limits.")]
    InstallFailed,
    #[error("Select a valid software type, Minecraft release and compatible build or loader.")]
    Invalid,
    #[error(
        "The software provider could not be reached or returned invalid metadata. Retry shortly."
    )]
    Upstream,
    #[error("The server software download failed integrity or size verification.")]
    Download,
    #[error("Server software could not be written to disk.")]
    Filesystem,
}
impl SoftwareError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::DownloadUnavailable => "software.download_unavailable",
            Self::PackUnsupported => "software.pack_unsupported",
            Self::FilesConflict => "software.files_conflict",
            Self::InstallFailed => "software.install_failed",
            Self::Invalid => "validation",
            Self::Upstream => "software.upstream",
            Self::Download => "software.download_failed",
            Self::Filesystem => "internal",
        }
    }
}
#[async_trait]
pub trait SoftwareService: Send + Sync {
    async fn prepare_with_progress(
        &self,
        software: &Software,
        directory: &Path,
        _progress: crate::progress::ProgressReporter,
    ) -> Result<Launch, SoftwareError> {
        self.prepare(software, directory).await
    }
    async fn prepare_plan_with_progress(
        &self,
        software: &Software,
        directory: &Path,
        options: &InstallOptions,
        lease: std::sync::Arc<dyn Send + Sync>,
        _progress: crate::progress::ProgressReporter,
    ) -> Result<PreparedSoftware, SoftwareError> {
        self.prepare_plan(software, directory, options, lease).await
    }
    async fn modpack(&self, _project_id: u64) -> Result<Value, SoftwareError> {
        Err(SoftwareError::DownloadUnavailable)
    }
    async fn modpack_logo(&self, _project_id: u64) -> Result<Vec<u8>, SoftwareError> {
        Err(SoftwareError::DownloadUnavailable)
    }
    async fn search_modpacks(&self, _query: &str, _index: u32) -> Result<Value, SoftwareError> {
        Err(SoftwareError::DownloadUnavailable)
    }
    async fn modpack_files(&self, _project_id: u64) -> Result<Value, SoftwareError> {
        Err(SoftwareError::DownloadUnavailable)
    }
    /// The opaque lease keeps the caller's staging directory and lifecycle lock alive
    /// through blocking extraction, even if the awaiting job is cancelled.
    async fn prepare_plan(
        &self,
        software: &Software,
        directory: &Path,
        _options: &InstallOptions,
        _lease: std::sync::Arc<dyn Send + Sync>,
    ) -> Result<PreparedSoftware, SoftwareError> {
        Ok(PreparedSoftware {
            launch: self.prepare(software, directory).await?,
            installer: None,
            instance_files: false,
        })
    }
    fn catalog(&self) -> Value;
    async fn versions(&self, kind: &str) -> Result<Value, SoftwareError>;
    async fn builds(&self, kind: &str, version: &str) -> Result<Value, SoftwareError>;
    /// Download a resolved artifact into the new caller-owned staging directory.
    async fn prepare(&self, software: &Software, directory: &Path)
    -> Result<Launch, SoftwareError>;
}
