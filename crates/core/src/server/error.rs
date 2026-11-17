use crate::repository::RepositoryError;
#[derive(Debug, thiserror::Error)]
pub enum ServerError {
    #[error("Restore this archived instance before using its local files or runtime.")]
    Archived,
    #[error("The image is invalid or exceeds decoding limits.")]
    IconInvalid,
    #[error("Use a PNG, JPEG, WebP or ICO image.")]
    IconUnsupported,
    #[error("The icon exceeds 2 MiB.")]
    IconTooLarge,
    #[error("No icon is available.")]
    IconNotFound,
    #[error("The display icon could not be saved or loaded.")]
    IconStorage,
    #[error("The configured launch file is missing. Check the launch settings and Files.")]
    MissingLaunch,
    #[error("{0}")]
    Invalid(&'static str),
    #[error("server not found")]
    NotFound,
    #[error("server operation already in progress")]
    Busy,
    #[error("another server is already running on this game port")]
    PortInUse,
    #[error("server is already running")]
    AlreadyRunning,
    #[error("server is not running")]
    NotRunning,
    #[error("place the configured server JAR in the server directory before starting")]
    MissingJar,
    #[error("Install the selected software before starting the server.")]
    NotInstalled,
    #[error("Server software is already installed; reinstalling could overwrite server files.")]
    AlreadyInstalled,
    #[error(transparent)]
    Software(#[from] crate::software::SoftwareError),
    #[error("accept the Minecraft EULA before starting")]
    EulaRequired,
    #[error("Docker is unavailable or is not a Linux container engine")]
    DockerUnavailable,
    #[error("all metrics sampling slots are busy; retry shortly")]
    MetricsBusy,
    #[error("container identity does not match this manager and server")]
    ContainerConflict,
    #[error("Docker operation failed")]
    Docker,
    #[error("server filesystem operation failed")]
    Filesystem,
    #[error(transparent)]
    Storage(#[from] RepositoryError),
}
impl ServerError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::Archived => "server.archived",
            Self::IconInvalid => "icons.invalid",
            Self::IconUnsupported => "icons.unsupported",
            Self::IconTooLarge => "icons.too_large",
            Self::IconNotFound => "icons.not_found",
            Self::IconStorage => "icons.storage",
            Self::MissingLaunch => "server.launch_missing",
            Self::Invalid(_) => "validation",
            Self::NotFound => "server.not_found",
            Self::Busy => "server.busy",
            Self::PortInUse => "server.port_in_use",
            Self::AlreadyRunning => "server.running",
            Self::NotRunning => "server.not_running",
            Self::Software(error) => error.code(),
            Self::NotInstalled => "server.not_installed",
            Self::AlreadyInstalled => "server.already_installed",
            Self::MissingJar => "server.jar_missing",
            Self::EulaRequired => "server.eula_required",
            Self::DockerUnavailable => "docker.unavailable",
            Self::MetricsBusy => "metrics.busy",
            Self::ContainerConflict => "docker.identity_mismatch",
            Self::Docker => "docker.failed",
            Self::Filesystem | Self::Storage(_) => "internal",
        }
    }
    pub fn public_detail(&self) -> String {
        match self {
            Self::Storage(_) => "The server record could not be saved or loaded.".into(),
            _ => self.to_string(),
        }
    }
}
