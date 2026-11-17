use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use chunkyard_auth::AuthError;
use chunkyard_core::jobs::JobError;
use serde::Serialize;

pub(crate) struct ApiError {
    status: StatusCode,
    pub(crate) code: &'static str,
    pub(crate) detail: &'static str,
}
#[derive(Serialize)]
struct Problem {
    #[serde(rename = "type")]
    type_url: String,
    title: &'static str,
    status: u16,
    code: &'static str,
    detail: &'static str,
}
impl ApiError {
    pub fn new(status: StatusCode, code: &'static str, detail: &'static str) -> Self {
        Self {
            status,
            code,
            detail,
        }
    }
    pub fn internal(error: impl std::fmt::Display) -> Self {
        tracing::error!(%error, "request operation failed");
        Self::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal",
            "The operation could not be completed.",
        )
    }
}
impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let mut response = (
            self.status,
            Json(Problem {
                type_url: format!("https://mcm.dev/problems/{}", self.code),
                title: self.status.canonical_reason().unwrap_or("Request failed"),
                status: self.status.as_u16(),
                code: self.code,
                detail: self.detail,
            }),
        )
            .into_response();
        response.headers_mut().insert(
            "content-type",
            axum::http::HeaderValue::from_static("application/problem+json"),
        );
        if self.status == StatusCode::TOO_MANY_REQUESTS {
            response
                .headers_mut()
                .insert("retry-after", axum::http::HeaderValue::from_static("60"));
        }
        response
    }
}
impl From<AuthError> for ApiError {
    fn from(error: AuthError) -> Self {
        use StatusCode as S;
        let (status, code, detail) = match error {
            AuthError::KeyName => (
                S::UNPROCESSABLE_ENTITY,
                "validation",
                "Use an API key name of 1–80 bytes without control characters.",
            ),
            AuthError::KeyLimit => (
                S::CONFLICT,
                "auth.key_limit",
                "At most 100 API keys are allowed; revoke an existing key first.",
            ),
            AuthError::InvalidCredentials => (
                S::UNAUTHORIZED,
                "auth.invalid_credentials",
                "The email or password is incorrect.",
            ),
            AuthError::Required => (S::UNAUTHORIZED, "auth.required", "Sign in to continue."),
            AuthError::SetupRequired => (
                S::SERVICE_UNAVAILABLE,
                "setup_required",
                "Complete initial setup first.",
            ),
            AuthError::AlreadySetup => (
                S::CONFLICT,
                "setup.already_done",
                "Initial setup has already completed.",
            ),
            AuthError::InvalidSetupToken => (
                S::UNAUTHORIZED,
                "setup.invalid_token",
                "The setup token is invalid.",
            ),
            AuthError::Email => (
                S::UNPROCESSABLE_ENTITY,
                "validation",
                "The email address is invalid.",
            ),
            AuthError::Password => (
                S::UNPROCESSABLE_ENTITY,
                "auth.weak_password",
                "Use a password of 10–256 characters that is not common.",
            ),
            AuthError::Throttled => (
                S::TOO_MANY_REQUESTS,
                "auth.throttled",
                "Too many authentication attempts; try again later.",
            ),
            _ => return Self::internal(error),
        };
        Self::new(status, code, detail)
    }
}
impl From<JobError> for ApiError {
    fn from(error: JobError) -> Self {
        match error {
            JobError::InvalidCursor => Self::new(
                StatusCode::BAD_REQUEST,
                "validation",
                "The job pagination cursor is invalid.",
            ),
            JobError::Busy => Self::new(
                StatusCode::TOO_MANY_REQUESTS,
                "job.busy",
                "The job executor is at capacity or shutting down.",
            ),
            _ => Self::internal(error),
        }
    }
}
pub(crate) async fn not_found() -> ApiError {
    ApiError::new(
        StatusCode::NOT_FOUND,
        "not_found",
        "This endpoint does not exist.",
    )
}
pub(crate) async fn method_not_allowed() -> ApiError {
    ApiError::new(
        StatusCode::METHOD_NOT_ALLOWED,
        "method_not_allowed",
        "This method is not supported for this endpoint.",
    )
}

impl From<chunkyard_core::server::ServerError> for ApiError {
    fn from(error: chunkyard_core::server::ServerError) -> Self {
        use chunkyard_core::server::ServerError as E;
        if let E::Software(error) = error {
            return error.into();
        }
        let status = match &error {
            E::Archived => StatusCode::CONFLICT,
            E::IconInvalid => StatusCode::UNPROCESSABLE_ENTITY,
            E::IconUnsupported => StatusCode::UNSUPPORTED_MEDIA_TYPE,
            E::IconTooLarge => StatusCode::PAYLOAD_TOO_LARGE,
            E::IconNotFound => StatusCode::NOT_FOUND,
            E::IconStorage => StatusCode::INTERNAL_SERVER_ERROR,
            E::Invalid(_) | E::EulaRequired => StatusCode::UNPROCESSABLE_ENTITY,
            E::NotFound => StatusCode::NOT_FOUND,
            E::Busy | E::PortInUse | E::AlreadyRunning | E::NotRunning | E::ContainerConflict => {
                StatusCode::CONFLICT
            }
            E::DockerUnavailable | E::MissingJar | E::MissingLaunch | E::NotInstalled => {
                StatusCode::FAILED_DEPENDENCY
            }
            E::MetricsBusy => StatusCode::TOO_MANY_REQUESTS,
            E::Docker => StatusCode::BAD_GATEWAY,
            E::AlreadyInstalled => StatusCode::CONFLICT,
            E::Software(_) | E::Filesystem | E::Storage(_) => return Self::internal(error),
        };
        // Domain messages contain only fixed text and never host paths.
        let detail = match &error {
            E::Archived => {
                "Restore this archived instance before using its local files or runtime."
            }
            E::IconInvalid => "The image is invalid or exceeds decoding limits.",
            E::IconUnsupported => "Use a PNG, JPEG, WebP or ICO image.",
            E::IconTooLarge => "The icon exceeds 2 MiB.",
            E::IconNotFound => "No icon is available.",
            E::IconStorage => "The display icon could not be saved or loaded.",
            E::Invalid(detail) => *detail,
            E::NotInstalled => "Install the selected software before starting the server.",
            E::AlreadyInstalled => "Server software is already installed.",
            E::NotFound => "The server does not exist.",
            E::Busy => "Another operation for this server is running.",
            E::MetricsBusy => "All metrics sampling slots are busy; retry shortly.",
            E::PortInUse => "Another server is already running on that game port.",
            E::AlreadyRunning => "The server is already running.",
            E::NotRunning => "The server is not running.",
            E::ContainerConflict => "Container ownership labels do not match this instance.",
            E::DockerUnavailable => "A reachable Linux Docker engine is required.",
            E::MissingJar => "Place the configured JAR in the server directory before starting.",
            E::MissingLaunch => {
                "The configured launch file is missing. Check Launch settings and Files."
            }
            E::EulaRequired => "Accept the Minecraft EULA before starting.",
            _ => "The Docker operation failed.",
        };
        Self::new(status, error.code(), detail)
    }
}

impl From<chunkyard_core::software::SoftwareError> for ApiError {
    fn from(error: chunkyard_core::software::SoftwareError) -> Self {
        use chunkyard_core::software::SoftwareError as E;
        let status = match error {
            E::Invalid => StatusCode::UNPROCESSABLE_ENTITY,
            E::PackUnsupported => StatusCode::UNPROCESSABLE_ENTITY,
            E::FilesConflict => StatusCode::CONFLICT,
            E::DownloadUnavailable => StatusCode::FAILED_DEPENDENCY,
            E::InstallFailed => StatusCode::BAD_GATEWAY,
            E::Upstream | E::Download => StatusCode::BAD_GATEWAY,
            E::Filesystem => StatusCode::INTERNAL_SERVER_ERROR,
        };
        let detail = match error {
            E::Invalid => "Select a valid software type, Minecraft release and Paper build.",
            E::DownloadUnavailable => {
                "The pack or file is unavailable for third-party download, or CurseForge is not configured."
            }
            E::PackUnsupported => {
                "Could not detect a supported server loader. Supply advanced install settings or select another release."
            }
            E::FilesConflict => {
                "Existing instance files conflict with this pack. Move them before retrying."
            }
            E::InstallFailed => {
                "The isolated loader installer failed. Check its logs and the instance resource limits."
            }
            E::Upstream => {
                "The software provider could not be reached or returned invalid metadata. Retry shortly."
            }
            E::Download => "The server software download failed integrity or size verification.",
            E::Filesystem => "Server software could not be written to disk.",
        };
        Self::new(status, error.code(), detail)
    }
}
