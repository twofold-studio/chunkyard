//! Managed Minecraft software and resolved launch provenance.
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase", deny_unknown_fields)]
pub enum Software {
    Vanilla {
        version: String,
    },
    Paper {
        version: String,
        #[serde(default)]
        build: Option<String>,
    },
}
impl Software {
    pub fn validate(&self) -> Result<(), SoftwareError> {
        component(self.version())?;
        if let Self::Paper {
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
            Self::Vanilla { version } | Self::Paper { version, .. } => version,
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
}
#[derive(Debug, thiserror::Error)]
pub enum SoftwareError {
    #[error("Select a valid software type, Minecraft release and Paper build.")]
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
            Self::Invalid => "validation",
            Self::Upstream => "software.upstream",
            Self::Download => "software.download_failed",
            Self::Filesystem => "internal",
        }
    }
}
#[async_trait]
pub trait SoftwareService: Send + Sync {
    fn catalog(&self) -> Value;
    async fn versions(&self, kind: &str) -> Result<Value, SoftwareError>;
    async fn builds(&self, kind: &str, version: &str) -> Result<Value, SoftwareError>;
    /// Download a resolved artifact into the new caller-owned staging directory.
    async fn prepare(&self, software: &Software, directory: &Path)
    -> Result<Launch, SoftwareError>;
}
