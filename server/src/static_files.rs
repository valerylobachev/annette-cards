use std::borrow::Cow;

use axum::{
    http::{Uri, header},
    response::{IntoResponse, Response},
};
use rust_embed::RustEmbed;

use crate::error::AppError;

/// The built PWA (`web/dist`), embedded into the binary at compile time in release builds.
/// Debug builds read the folder from disk at runtime, and `allow_missing` lets `cargo check`/`test` run before the
/// web is built. `just build` builds the web first.
#[derive(RustEmbed)]
#[folder = "../web/dist"]
#[allow_missing = true]
struct WebDist;

/// Router fallback: embedded files, SPA fallback to `index.html`, JSON 404 for unknown `/api/*` paths.
pub async fn serve(uri: Uri) -> Result<Response, AppError> {
    serve_from::<WebDist>(uri.path())
}

fn serve_from<Assets: RustEmbed>(path: &str) -> Result<Response, AppError> {
    if path == "/api" || path.starts_with("/api/") {
        return Err(AppError::NotFound);
    }

    let file_path = match path.trim_start_matches('/') {
        "" => "index.html",
        other => other,
    };
    if let Some(file) = Assets::get(file_path) {
        return Ok(file_response(file_path, file.data));
    }

    // Client-side routes (/decks/123) get the app shell; missing files (/assets/old.js) stay 404.
    let looks_like_file = file_path
        .rsplit('/')
        .next()
        .is_some_and(|name| name.contains('.'));
    match Assets::get("index.html") {
        Some(index) if !looks_like_file => Ok(file_response("index.html", index.data)),
        _ => Err(AppError::NotFound),
    }
}

fn file_response(path: &str, data: Cow<'static, [u8]>) -> Response {
    let content_type = mime_guess::from_path(path).first_or_octet_stream();
    (
        [
            (header::CONTENT_TYPE, content_type.as_ref()),
            (header::CACHE_CONTROL, cache_control(path)),
        ],
        data,
    )
        .into_response()
}

/// Vite puts content-hashed files into `assets/`; everything else (index.html, sw.js, manifest) must be revalidated
/// so that updates reach clients.
fn cache_control(path: &str) -> &'static str {
    if path.starts_with("assets/") {
        "public, max-age=31536000, immutable"
    } else {
        "no-cache"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::StatusCode;
    use http_body_util::BodyExt;

    #[derive(RustEmbed)]
    #[folder = "tests/fixtures/dist"]
    struct FixtureDist;

    async fn get(path: &str) -> (StatusCode, Option<String>, Option<String>, String) {
        let response = match serve_from::<FixtureDist>(path) {
            Ok(response) => response,
            Err(error) => error.into_response(),
        };
        let header = |name| {
            response
                .headers()
                .get(name)
                .map(|v| v.to_str().unwrap().to_string())
        };
        let (content_type, cache) = (header(header::CONTENT_TYPE), header(header::CACHE_CONTROL));
        let status = response.status();
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        (
            status,
            content_type,
            cache,
            String::from_utf8(bytes.to_vec()).unwrap(),
        )
    }

    #[tokio::test]
    async fn root_serves_index_html_without_caching() {
        let (status, content_type, cache, body) = get("/").await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(content_type.as_deref(), Some("text/html"));
        assert_eq!(cache.as_deref(), Some("no-cache"));
        assert!(body.contains("app shell"));
    }

    #[tokio::test]
    async fn client_routes_fall_back_to_index_html() {
        let (status, _, _, body) = get("/decks/0191e2a4").await;
        assert_eq!(status, StatusCode::OK);
        assert!(body.contains("app shell"));
    }

    #[tokio::test]
    async fn hashed_assets_are_immutable() {
        let (status, content_type, cache, _) = get("/assets/index-abc123.js").await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(content_type.as_deref(), Some("text/javascript"));
        assert_eq!(
            cache.as_deref(),
            Some("public, max-age=31536000, immutable")
        );
    }

    #[tokio::test]
    async fn missing_files_are_404() {
        let (status, _, _, _) = get("/assets/missing.js").await;
        assert_eq!(status, StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn unknown_api_paths_are_json_404() {
        let (status, content_type, _, body) = get("/api/nope").await;
        assert_eq!(status, StatusCode::NOT_FOUND);
        assert_eq!(content_type.as_deref(), Some("application/json"));
        assert_eq!(body, r#"{"code":"not_found","details":null}"#);
    }
}
