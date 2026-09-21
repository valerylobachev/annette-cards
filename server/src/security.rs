//! Cross-cutting request security (architecture.md §5.2, §9): Origin check, per-IP rate limits, security headers
//! and request ids.

use std::{sync::Arc, time::Duration};

use axum::{
    extract::{Request, State},
    http::{HeaderName, HeaderValue, Method, header},
    middleware::Next,
    response::{IntoResponse, Response},
};
use tower_governor::{
    GovernorError, GovernorLayer, governor::GovernorConfigBuilder,
    key_extractor::SmartIpKeyExtractor,
};
use tower_http::request_id::{MakeRequestId, RequestId};
use utoipa_axum::router::OpenApiRouter;
use uuid::Uuid;

use crate::{app::AppState, error::AppError};

/// `Content-Security-Policy`: everything from this origin only, with two exceptions the PWA needs: `data:` images,
/// and inline styles (`react-remove-scroll`, used by the dialogs, injects a computed `<style>` element to lock page
/// scrolling). Scripts stay strictly same-origin. Objects, `<base>` changes and framing by other sites are forbidden.
pub const CONTENT_SECURITY_POLICY: &str = "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; \
     object-src 'none'; base-uri 'self'; frame-ancestors 'none'";

/// The headers set on every response.
pub fn security_headers() -> [(HeaderName, HeaderValue); 3] {
    [
        (
            header::CONTENT_SECURITY_POLICY,
            HeaderValue::from_static(CONTENT_SECURITY_POLICY),
        ),
        (
            header::X_CONTENT_TYPE_OPTIONS,
            HeaderValue::from_static("nosniff"),
        ),
        (
            header::REFERRER_POLICY,
            HeaderValue::from_static("same-origin"),
        ),
    ]
}

/// CSRF protection on top of `SameSite=Strict`: a request that can change data (anything but GET, HEAD, OPTIONS)
/// under `/api` must carry an `Origin` header naming this site. Otherwise 403 `origin_mismatch`.
pub async fn check_origin(
    State(state): State<Arc<AppState>>,
    request: Request,
    next: Next,
) -> Result<Response, AppError> {
    let safe_method = matches!(
        *request.method(),
        Method::GET | Method::HEAD | Method::OPTIONS
    );
    if !safe_method && request.uri().path().starts_with("/api/") {
        let origin = request
            .headers()
            .get(header::ORIGIN)
            .and_then(|value| value.to_str().ok());
        if !origin.is_some_and(|origin| state.config.allows_origin(origin)) {
            return Err(AppError::OriginMismatch);
        }
    }
    Ok(next.run(request).await)
}

/// A token bucket per client IP: `burst` requests at once, then one more every `refill`.
#[derive(Debug, Clone, Copy)]
pub struct RateLimit {
    pub burst: u32,
    pub refill: Duration,
}

/// Login and registration: 10 attempts a minute per IP (architecture.md §9).
pub const AUTH_RATE_LIMIT: RateLimit = RateLimit {
    burst: 10,
    refill: Duration::from_secs(6),
};

/// Applies a per-IP rate limit to every route of `routes`; over the limit the client gets 429 `rate_limited` with a
/// `Retry-After` header. The client IP comes from `X-Forwarded-For` (set by Caddy in production), falling back to
/// the TCP peer address.
pub fn limit_per_ip<S>(routes: OpenApiRouter<S>, limit: RateLimit) -> OpenApiRouter<S>
where
    S: Clone + Send + Sync + 'static,
{
    let config = GovernorConfigBuilder::default()
        .key_extractor(SmartIpKeyExtractor)
        .period(limit.refill)
        .burst_size(limit.burst)
        .finish()
        .expect("burst and refill are not zero");
    routes.layer(GovernorLayer::new(config).error_handler(rate_limit_response))
}

fn rate_limit_response(error: GovernorError) -> Response {
    match error {
        GovernorError::TooManyRequests { headers, .. } => {
            let mut response = AppError::RateLimited.into_response();
            if let Some(headers) = headers {
                response.headers_mut().extend(headers);
            }
            response
        }
        other => AppError::Internal(anyhow::anyhow!("rate limiter: {other}")).into_response(),
    }
}

/// `x-request-id` values: UUIDv7, like every other id in the project. An id already set by the proxy is kept.
#[derive(Debug, Clone, Copy, Default)]
pub struct UuidV7RequestId;

impl MakeRequestId for UuidV7RequestId {
    fn make_request_id<B>(&mut self, _request: &axum::http::Request<B>) -> Option<RequestId> {
        let id = HeaderValue::from_str(&Uuid::now_v7().to_string()).ok()?;
        Some(RequestId::new(id))
    }
}

#[cfg(test)]
mod tests {
    use axum::{
        body::Body,
        http::{Request, StatusCode, header},
    };
    use serde_json::json;
    use sqlx::SqlitePool;

    use crate::test_support::{PASSWORD, create_user, get, post_json, send, test_app};

    fn login_body() -> serde_json::Value {
        json!({ "email": "anna@example.com", "password": PASSWORD })
    }

    fn post_with_origin(origin: Option<&str>) -> Request<Body> {
        let mut builder =
            Request::post("/api/auth/login").header(header::CONTENT_TYPE, "application/json");
        if let Some(origin) = origin {
            builder = builder.header(header::ORIGIN, origin);
        }
        builder.body(Body::from(login_body().to_string())).unwrap()
    }

    #[sqlx::test]
    async fn unsafe_api_requests_need_this_origin(pool: SqlitePool) {
        create_user(&pool, "anna@example.com", false).await;
        let app = test_app(pool);

        for origin in [
            None,
            Some("https://evil.example.com"),
            Some("http://localhost:5173"),
        ] {
            let response = send(&app, post_with_origin(origin)).await;
            assert_eq!(response.status, StatusCode::FORBIDDEN, "{origin:?}");
            assert_eq!(
                response.body,
                json!({ "code": "origin_mismatch", "details": null })
            );
        }
        let response = send(&app, post_with_origin(Some(crate::test_support::ORIGIN))).await;
        assert_eq!(response.status, StatusCode::OK);
    }

    #[sqlx::test]
    async fn safe_requests_need_no_origin(pool: SqlitePool) {
        let app = test_app(pool);
        assert_eq!(
            send(&app, get("/api/health", None)).await.status,
            StatusCode::OK
        );
        assert_eq!(
            send(&app, get("/api/auth/me", None)).await.status,
            StatusCode::UNAUTHORIZED
        );
    }

    #[sqlx::test]
    async fn the_eleventh_login_in_a_minute_is_rate_limited(pool: SqlitePool) {
        let app = test_app(pool);
        let wrong = json!({ "email": "anna@example.com", "password": "wrong password!" });
        for attempt in 1..=10 {
            let response = send(&app, post_json("/api/auth/login", &wrong, None)).await;
            assert_eq!(
                response.status,
                StatusCode::UNAUTHORIZED,
                "attempt {attempt}"
            );
        }
        let limited = send(&app, post_json("/api/auth/login", &wrong, None)).await;
        assert_eq!(limited.status, StatusCode::TOO_MANY_REQUESTS);
        assert_eq!(
            limited.body,
            json!({ "code": "rate_limited", "details": null })
        );
        assert!(limited.headers.contains_key(header::RETRY_AFTER));

        // Registration shares the sign-in budget; other routes are not limited.
        let register = send(&app, post_json("/api/auth/register", &json!({}), None)).await;
        assert_eq!(register.status, StatusCode::TOO_MANY_REQUESTS);
        assert_eq!(
            send(&app, get("/api/health", None)).await.status,
            StatusCode::OK
        );
    }

    #[sqlx::test]
    async fn every_response_has_security_headers_and_a_request_id(pool: SqlitePool) {
        let app = test_app(pool);
        for uri in ["/api/health", "/", "/api/nope"] {
            let response = send(&app, get(uri, None)).await;
            let headers = &response.headers;
            assert_eq!(
                headers[header::CONTENT_SECURITY_POLICY],
                super::CONTENT_SECURITY_POLICY,
                "{uri}"
            );
            assert_eq!(headers[header::X_CONTENT_TYPE_OPTIONS], "nosniff", "{uri}");
            assert_eq!(headers[header::REFERRER_POLICY], "same-origin", "{uri}");
            let request_id = headers["x-request-id"].to_str().unwrap();
            let id = uuid::Uuid::parse_str(request_id).unwrap();
            assert_eq!(id.get_version_num(), 7, "{uri}");
        }
    }

    #[test]
    fn user_log_id_is_twelve_hex_characters_of_the_hash() {
        let id = crate::auth::extractor::user_log_id("0192f6c1-0000-7000-8000-000000000000");
        assert_eq!(id.len(), 12);
        assert!(id.chars().all(|c| c.is_ascii_hexdigit()));
    }
}
