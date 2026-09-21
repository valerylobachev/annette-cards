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
    #[error("not found")]
    NotFound,
    #[error("service unavailable")]
    ServiceUnavailable,
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
            AppError::NotFound => StatusCode::NOT_FOUND,
            AppError::ServiceUnavailable => StatusCode::SERVICE_UNAVAILABLE,
            AppError::Database(_) | AppError::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
        }
    }

    fn code(&self) -> &'static str {
        match self {
            AppError::NotFound => "not_found",
            AppError::ServiceUnavailable => "service_unavailable",
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
