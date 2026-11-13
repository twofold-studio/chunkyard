use crate::error::ApiError;
use axum::{
    Json,
    extract::{FromRequest, Request},
    http::StatusCode,
};
use serde::de::DeserializeOwned;

/// Keep JSON extractor failures in the same problem+json format as service errors.
pub(crate) struct ApiJson<T>(pub T);
impl<S, T> FromRequest<S> for ApiJson<T>
where
    S: Send + Sync,
    T: DeserializeOwned,
{
    type Rejection = ApiError;
    async fn from_request(request: Request, state: &S) -> Result<Self, Self::Rejection> {
        match Json::<T>::from_request(request, state).await {
            Ok(Json(value)) => Ok(Self(value)),
            Err(error) => {
                let status = error.status();
                let code = if status == StatusCode::PAYLOAD_TOO_LARGE {
                    "request.too_large"
                } else {
                    "validation"
                };
                Err(ApiError::new(
                    status,
                    code,
                    "The request body is missing, malformed, too large, or has invalid fields.",
                ))
            }
        }
    }
}
