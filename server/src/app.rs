use std::{sync::Arc, time::Duration};

use axum::{Json, Router, http::StatusCode, routing::get};
use sqlx::SqlitePool;
use tower_http::{
    compression::CompressionLayer, cors::CorsLayer, timeout::TimeoutLayer, trace::TraceLayer,
};
use utoipa::OpenApi;
use utoipa_axum::{router::OpenApiRouter, routes};

use crate::{config::Config, error::ErrorBody, health, static_files};

/// Shared by all requests through `Arc` (cheap to clone, read-only).
pub struct AppState {
    pub pool: SqlitePool,
    #[expect(
        dead_code,
        reason = "first read by auth (P2-T01) and the origin check (P2-T02)"
    )]
    pub config: Config,
}

#[derive(OpenApi)]
#[openapi(info(title = "Annette Cards API"), components(schemas(ErrorBody)))]
struct ApiDoc;

/// All `/api` routes together with their OpenAPI description.
fn api_routes() -> OpenApiRouter<Arc<AppState>> {
    let mut doc = ApiDoc::openapi();
    // Set here, not in the derive: values the macro reads from Cargo.toml can stay stale in incremental builds.
    doc.info.version = env!("CARGO_PKG_VERSION").to_string();
    doc.info.description = Some(env!("CARGO_PKG_DESCRIPTION").to_string());
    doc.info.license = None;

    OpenApiRouter::with_openapi(doc)
        .routes(routes!(health::health))
        .routes(routes!(health::meta))
}

/// The OpenAPI spec, printed by the `openapi` subcommand and served at `/api/openapi.json`.
pub fn openapi() -> utoipa::openapi::OpenApi {
    api_routes().into_openapi()
}

pub fn router(state: Arc<AppState>) -> Router {
    let (api, spec) = api_routes().split_for_parts();
    let spec = Arc::new(spec);

    let app = Router::new()
        .merge(api)
        .route(
            "/api/openapi.json",
            get(move || async move { Json(spec.as_ref().clone()) }),
        )
        .fallback(static_files::serve)
        .with_state(state)
        // The last layer added runs first: trace → compression → timeout → handler (architecture.md §5.2).
        .layer(TimeoutLayer::with_status_code(
            StatusCode::REQUEST_TIMEOUT,
            Duration::from_secs(30),
        ))
        .layer(CompressionLayer::new())
        .layer(TraceLayer::new_for_http());

    if cfg!(debug_assertions) {
        // Dev only: lets tools on other origins call the API. Production is same-origin behind Caddy.
        app.layer(CorsLayer::permissive())
    } else {
        app
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{body::Body, http::Request};
    use http_body_util::BodyExt;
    use tower::ServiceExt;

    fn test_app(pool: SqlitePool) -> Router {
        router(Arc::new(AppState {
            pool,
            config: Config::default(),
        }))
    }

    async fn get_json(app: Router, uri: &str) -> (StatusCode, serde_json::Value) {
        let request = Request::get(uri).body(Body::empty()).unwrap();
        let response = app.oneshot(request).await.unwrap();
        let status = response.status();
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        (status, serde_json::from_slice(&bytes).unwrap())
    }

    #[test]
    fn openapi_info_comes_from_the_package() {
        let info = openapi().info;
        assert_eq!(info.title, "Annette Cards API");
        assert_eq!(info.version, env!("CARGO_PKG_VERSION"));
        assert_eq!(
            info.description.as_deref(),
            Some(env!("CARGO_PKG_DESCRIPTION"))
        );
        assert!(info.license.is_none());
    }

    #[sqlx::test]
    async fn health_is_ok(pool: SqlitePool) {
        let (status, body) = get_json(test_app(pool), "/api/health").await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body, serde_json::json!({ "status": "ok" }));
    }

    #[sqlx::test]
    async fn health_is_503_when_the_database_is_down(pool: SqlitePool) {
        let app = test_app(pool.clone());
        pool.close().await;
        let (status, body) = get_json(app, "/api/health").await;
        assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(body["code"], "service_unavailable");
    }

    #[sqlx::test]
    async fn meta_reports_version_and_disabled_features(pool: SqlitePool) {
        let (status, body) = get_json(test_app(pool), "/api/meta").await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["version"], env!("CARGO_PKG_VERSION"));
        assert_eq!(
            body["features"],
            serde_json::json!({ "tts": false, "commons": false, "enrich": false, "push": false })
        );
    }

    #[sqlx::test]
    async fn unknown_api_path_is_json_404(pool: SqlitePool) {
        let (status, body) = get_json(test_app(pool), "/api/unknown").await;
        assert_eq!(status, StatusCode::NOT_FOUND);
        assert_eq!(
            body,
            serde_json::json!({ "code": "not_found", "details": null })
        );
    }

    #[sqlx::test]
    async fn openapi_json_matches_the_cli_spec(pool: SqlitePool) {
        let (status, body) = get_json(test_app(pool), "/api/openapi.json").await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body, serde_json::to_value(openapi()).unwrap());
        assert!(body["paths"]["/api/health"]["get"].is_object());
        assert!(body["paths"]["/api/meta"]["get"].is_object());
    }
}
