//! Helpers for router tests: build the app on a test database, send requests, read cookies and JSON.

use std::{net::SocketAddr, sync::Arc};

use axum::{
    Router,
    body::Body,
    extract::ConnectInfo,
    http::{HeaderMap, Request, StatusCode, header},
};
use http_body_util::BodyExt;
use serde_json::Value;
use sqlx::SqlitePool;
use tower::ServiceExt;

use crate::{
    app::{self, AppState},
    auth::{
        SESSION_COOKIE,
        users::{self, NewUser, User},
    },
    config::Config,
};

pub const PASSWORD: &str = "correct horse battery";
/// `ANNETTE_PUBLIC_URL` of the test app; `post_json` and `delete` send it as `Origin`.
pub const ORIGIN: &str = "https://cards.test";

pub fn test_app(pool: SqlitePool) -> Router {
    app::router(Arc::new(test_state(pool)))
}

/// The state of `test_app`, for tests that swap a provider for a fake.
pub fn test_state(pool: SqlitePool) -> AppState {
    AppState::new(pool, test_config()).unwrap()
}

/// External providers are off: tests that need one inject a fake, so no test reaches the network.
pub fn test_config() -> Config {
    Config {
        public_url: Some(ORIGIN.to_string()),
        dev_origins: false,
        commons_enabled: false,
        ..Config::default()
    }
}

pub async fn create_user(pool: &SqlitePool, email: &str, is_admin: bool) -> User {
    let mut conn = pool.acquire().await.unwrap();
    let new = NewUser {
        email,
        display_name: "Test User",
        password: PASSWORD,
        is_admin,
    };
    users::create_user(&mut conn, new).await.unwrap()
}

pub struct TestResponse {
    pub status: StatusCode,
    pub headers: HeaderMap,
    pub body: Value,
}

impl TestResponse {
    /// The error code of a `{ "code": …, "details": … }` body.
    pub fn code(&self) -> &str {
        self.body["code"].as_str().unwrap_or_default()
    }

    /// The raw `Set-Cookie` header for the session cookie, if the response sets one.
    pub fn session_set_cookie(&self) -> Option<String> {
        self.headers
            .get_all(header::SET_COOKIE)
            .iter()
            .map(|value| value.to_str().unwrap().to_string())
            .find(|value| value.starts_with(&format!("{SESSION_COOKIE}=")))
    }

    /// `ac_session=<token>`, ready to send back in a `Cookie` header.
    pub fn session_cookie(&self) -> String {
        let set_cookie = self
            .session_set_cookie()
            .expect("response sets the session cookie");
        set_cookie.split(';').next().unwrap().to_string()
    }
}

/// Sends a request as if from 127.0.0.1 (the rate limiter keys on the peer address, which `axum::serve` provides
/// in production).
pub async fn send(app: &Router, mut request: Request<Body>) -> TestResponse {
    let peer = SocketAddr::from(([127, 0, 0, 1], 50_000));
    request.extensions_mut().insert(ConnectInfo(peer));
    let response = app.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let headers = response.headers().clone();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let body = if bytes.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&bytes)
            .unwrap_or_else(|_| Value::String(String::from_utf8_lossy(&bytes).into()))
    };
    TestResponse {
        status,
        headers,
        body,
    }
}

pub fn get(uri: &str, cookie: Option<&str>) -> Request<Body> {
    let mut builder = Request::get(uri);
    if let Some(cookie) = cookie {
        builder = builder.header(header::COOKIE, cookie);
    }
    builder.body(Body::empty()).unwrap()
}

pub fn post_json(uri: &str, body: &Value, cookie: Option<&str>) -> Request<Body> {
    let mut builder = Request::post(uri)
        .header(header::CONTENT_TYPE, "application/json")
        .header(header::ORIGIN, ORIGIN);
    if let Some(cookie) = cookie {
        builder = builder.header(header::COOKIE, cookie);
    }
    builder.body(Body::from(body.to_string())).unwrap()
}

pub fn delete(uri: &str, cookie: Option<&str>) -> Request<Body> {
    let mut builder = Request::delete(uri).header(header::ORIGIN, ORIGIN);
    if let Some(cookie) = cookie {
        builder = builder.header(header::COOKIE, cookie);
    }
    builder.body(Body::empty()).unwrap()
}

pub fn delete_json(uri: &str, body: &Value, cookie: Option<&str>) -> Request<Body> {
    let mut builder = Request::delete(uri)
        .header(header::CONTENT_TYPE, "application/json")
        .header(header::ORIGIN, ORIGIN);
    if let Some(cookie) = cookie {
        builder = builder.header(header::COOKIE, cookie);
    }
    builder.body(Body::from(body.to_string())).unwrap()
}

/// Signs in and returns the `ac_session=<token>` cookie.
pub async fn login(app: &Router, email: &str, password: &str) -> String {
    let body = serde_json::json!({ "email": email, "password": password });
    let response = send(app, post_json("/api/auth/login", &body, None)).await;
    assert_eq!(
        response.status,
        StatusCode::OK,
        "login failed: {}",
        response.body
    );
    response.session_cookie()
}
