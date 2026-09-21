use axum::{
    Json,
    extract::{FromRequest, Request, rejection::JsonRejection},
    http::StatusCode,
};

use crate::error::AppError;

/// `axum::Json` for request bodies, but with our error format: a body over the route's size limit is 413
/// `payload_too_large`, any other unreadable or mistyped body is 400 `validation_failed`. (Plain `Json` answers
/// with a text message, and the server never sends user-visible text.)
pub struct AppJson<T>(pub T);

impl<S, T> FromRequest<S> for AppJson<T>
where
    Json<T>: FromRequest<S, Rejection = JsonRejection>,
    S: Send + Sync,
{
    type Rejection = AppError;

    async fn from_request(request: Request, state: &S) -> Result<Self, AppError> {
        match Json::<T>::from_request(request, state).await {
            Ok(Json(value)) => Ok(Self(value)),
            Err(rejection) if rejection.status() == StatusCode::PAYLOAD_TOO_LARGE => {
                Err(AppError::PayloadTooLarge)
            }
            Err(rejection) => {
                tracing::debug!(%rejection, "rejected request body");
                Err(AppError::BadRequest("validation_failed"))
            }
        }
    }
}
