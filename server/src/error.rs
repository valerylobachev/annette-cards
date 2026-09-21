use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// Errors returned by handlers. Each variant maps to an HTTP status and a stable error code;
/// the client translates codes into user-visible text (`errors.<code>`).
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    /// The request is invalid; the code says why (`password_too_short`, `validation_failed`, …).
    #[error("bad request: {0}")]
    BadRequest(&'static str),
    /// Wrong email or password at login.
    #[error("invalid credentials")]
    InvalidCredentials,
    /// No valid session cookie.
    #[error("unauthorized")]
    Unauthorized,
    /// Signed in, but not allowed (e.g. not an admin).
    #[error("forbidden")]
    Forbidden,
    /// An unsafe request (POST, PUT, DELETE…) from another origin, or without an `Origin` header.
    #[error("origin mismatch")]
    OriginMismatch,
    /// The request body is larger than the route allows.
    #[error("payload too large")]
    PayloadTooLarge,
    /// Too many requests from this client; try again later.
    #[error("rate limited")]
    RateLimited,
    #[error("not found")]
    NotFound,
    /// The request conflicts with existing data; the code says how (`email_taken`, …).
    #[error("conflict: {0}")]
    Conflict(&'static str),
    #[error("service unavailable")]
    ServiceUnavailable,
    /// An external service (TTS, Wikimedia, LLM) failed or answered with an error.
    #[error("provider error")]
    ProviderError,
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("internal error: {0}")]
    Internal(#[from] anyhow::Error),
}

/// Error response body: `{ "code": "not_found", "details": null }`.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct ErrorBody {
    /// Stable snake_case error code, never user-facing text.
    pub code: String,
    /// Optional machine-readable details (e.g. which field is invalid).
    pub details: Option<serde_json::Value>,
}

impl AppError {
    fn status(&self) -> StatusCode {
        match self {
            AppError::BadRequest(_) => StatusCode::BAD_REQUEST,
            AppError::InvalidCredentials | AppError::Unauthorized => StatusCode::UNAUTHORIZED,
            AppError::Forbidden | AppError::OriginMismatch => StatusCode::FORBIDDEN,
            AppError::PayloadTooLarge => StatusCode::PAYLOAD_TOO_LARGE,
            AppError::RateLimited => StatusCode::TOO_MANY_REQUESTS,
            AppError::NotFound => StatusCode::NOT_FOUND,
            AppError::Conflict(_) => StatusCode::CONFLICT,
            AppError::ServiceUnavailable => StatusCode::SERVICE_UNAVAILABLE,
            AppError::ProviderError => StatusCode::BAD_GATEWAY,
            AppError::Database(_) | AppError::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
        }
    }

    fn code(&self) -> &'static str {
        match self {
            AppError::BadRequest(code) | AppError::Conflict(code) => code,
            AppError::InvalidCredentials => "invalid_credentials",
            AppError::Unauthorized => "unauthorized",
            AppError::Forbidden => "forbidden",
            AppError::OriginMismatch => "origin_mismatch",
            AppError::PayloadTooLarge => "payload_too_large",
            AppError::RateLimited => "rate_limited",
            AppError::NotFound => "not_found",
            AppError::ServiceUnavailable => "service_unavailable",
            AppError::ProviderError => "provider_error",
            AppError::Database(_) | AppError::Internal(_) => "internal_error",
        }
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let status = self.status();
        if status.is_server_error() {
            // The cause goes to the log only; the client gets just the code.
            tracing::error!(error = %self, "request failed");
        }
        let body = ErrorBody {
            code: self.code().to_string(),
            details: None,
        };
        (status, Json(body)).into_response()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use http_body_util::BodyExt;

    async fn response_parts(error: AppError) -> (StatusCode, serde_json::Value) {
        let response = error.into_response();
        let status = response.status();
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        (status, serde_json::from_slice(&bytes).unwrap())
    }

    #[tokio::test]
    async fn not_found_becomes_404_with_code() {
        let (status, body) = response_parts(AppError::NotFound).await;
        assert_eq!(status, StatusCode::NOT_FOUND);
        assert_eq!(
            body,
            serde_json::json!({ "code": "not_found", "details": null })
        );
    }

    #[tokio::test]
    async fn coded_errors_carry_their_code() {
        let (status, body) = response_parts(AppError::BadRequest("password_too_short")).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(body["code"], "password_too_short");
        let (status, body) = response_parts(AppError::Unauthorized).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
        assert_eq!(body["code"], "unauthorized");
    }

    #[tokio::test]
    async fn internal_error_hides_the_cause() {
        let (status, body) =
            response_parts(AppError::Internal(anyhow::anyhow!("disk on fire"))).await;
        assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
        assert_eq!(
            body,
            serde_json::json!({ "code": "internal_error", "details": null })
        );
    }
}
