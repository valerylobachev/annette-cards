use std::{sync::Arc, time::Duration};

use axum::{
    Json, Router,
    body::Body,
    extract::DefaultBodyLimit,
    http::{HeaderName, StatusCode},
    middleware,
    routing::get,
};
use sqlx::SqlitePool;
use tower_http::{
    compression::CompressionLayer,
    cors::CorsLayer,
    request_id::{PropagateRequestIdLayer, SetRequestIdLayer},
    set_header::SetResponseHeaderLayer,
    timeout::TimeoutLayer,
    trace::TraceLayer,
};
use tracing::Span;
use utoipa::{
    Modify, OpenApi,
    openapi::security::{ApiKey, ApiKeyValue, SecurityScheme},
};
use utoipa_axum::{router::OpenApiRouter, routes};

use crate::{
    admin,
    audio::{
        self,
        azure::AzureTts,
        commons::{RecordingSource, WikimediaCommons},
        tts::TtsProvider,
    },
    auth::{self, SESSION_COOKIE},
    clock::{HOUR_MS, MINUTE_MS},
    config::Config,
    enrich::{self, Enricher, anthropic::AnthropicEnricher},
    error::ErrorBody,
    health,
    push::{self, PushSender, sender::WebPushSender},
    security::{self, PerUserLimit, UuidV7RequestId},
    static_files, sync,
};

const REQUEST_ID: HeaderName = HeaderName::from_static("x-request-id");

/// Timeout of calls to external services (TTS, Wikimedia, LLM).
const PROVIDER_TIMEOUT: Duration = Duration::from_secs(10);

/// Shared by all requests through `Arc` (cheap to clone, read-only).
pub struct AppState {
    pub pool: SqlitePool,
    pub config: Config,
    /// The text-to-speech provider; `None` when TTS is not configured (`features.tts = false`).
    pub tts: Option<Arc<dyn TtsProvider>>,
    /// Wikimedia Commons recordings; `None` when turned off (`features.commons = false`).
    pub commons: Option<Arc<dyn RecordingSource>>,
    /// Per-user limit of `POST /api/cards/{id}/audio`.
    pub audio_limit: PerUserLimit,
    /// The language model for suggestions; `None` without an API key (`features.enrich = false`).
    pub enricher: Option<Arc<dyn Enricher>>,
    /// Per-user burst limit of `POST /api/enrich` (the daily quota is in the database).
    pub enrich_limit: PerUserLimit,
    /// The Web Push sender; `None` without VAPID keys (`features.push = false`).
    pub push: Option<Arc<dyn PushSender>>,
}

impl AppState {
    /// The state for `config`: providers are created for the features that have their settings.
    pub fn new(pool: SqlitePool, config: Config) -> anyhow::Result<Self> {
        let http = reqwest::Client::builder()
            .timeout(PROVIDER_TIMEOUT)
            // Wikimedia asks every client to name itself and a contact (https://meta.wikimedia.org/wiki/User-Agent_policy).
            .user_agent(concat!(
                "annette-cards/",
                env!("CARGO_PKG_VERSION"),
                " (",
                env!("CARGO_PKG_REPOSITORY"),
                ")"
            ))
            .build()?;
        let tts = config.azure_tts().map(|(key, region)| {
            Arc::new(AzureTts::new(http.clone(), key.clone(), region)) as Arc<dyn TtsProvider>
        });
        let commons = config
            .commons_enabled
            .then(|| Arc::new(WikimediaCommons::new(http.clone())) as Arc<dyn RecordingSource>);
        let enricher = config.anthropic_key().map(|key| {
            let model = config.llm_model.clone();
            Arc::new(AnthropicEnricher::new(http.clone(), key.clone(), model)) as Arc<dyn Enricher>
        });
        let push = match config.vapid() {
            Some((public, private)) => {
                let sender = WebPushSender::new(
                    http.clone(),
                    public,
                    private.expose(),
                    vapid_contact(&config),
                )?;
                Some(Arc::new(sender) as Arc<dyn PushSender>)
            }
            None => None,
        };
        Ok(Self {
            pool,
            config,
            push,
            tts,
            commons,
            audio_limit: PerUserLimit::new(security::AUDIO_REQUESTS_PER_HOUR, HOUR_MS),
            enricher,
            enrich_limit: PerUserLimit::new(security::ENRICH_REQUESTS_PER_MINUTE, MINUTE_MS),
        })
    }
}

/// The VAPID `sub` claim: the site's URL, so a push service can tell whose messages these are.
fn vapid_contact(config: &Config) -> String {
    config
        .public_url
        .clone()
        .unwrap_or_else(|| env!("CARGO_PKG_REPOSITORY").to_string())
}

#[derive(OpenApi)]
#[openapi(
    info(title = "Annette Cards API"),
    components(schemas(ErrorBody)),
    modifiers(&SessionCookieScheme)
)]
struct ApiDoc;

/// Declares the `session` security scheme (the `ac_session` cookie) referenced by `security(("session" = []))`.
struct SessionCookieScheme;

impl Modify for SessionCookieScheme {
    fn modify(&self, openapi: &mut utoipa::openapi::OpenApi) {
        let components = openapi.components.get_or_insert_with(Default::default);
        let cookie = ApiKey::Cookie(ApiKeyValue::new(SESSION_COOKIE));
        components.add_security_scheme("session", SecurityScheme::ApiKey(cookie));
    }
}

/// All `/api` routes together with their OpenAPI description.
fn api_routes() -> OpenApiRouter<Arc<AppState>> {
    let mut doc = ApiDoc::openapi();
    // Set here, not in the derive: values the macro reads from Cargo.toml can stay stale in incremental builds.
    doc.info.version = env!("CARGO_PKG_VERSION").to_string();
    doc.info.description = Some(env!("CARGO_PKG_DESCRIPTION").to_string());
    doc.info.license = None;

    let sign_in = OpenApiRouter::new()
        .routes(routes!(auth::handlers::login))
        .routes(routes!(auth::handlers::register));

    OpenApiRouter::with_openapi(doc)
        .routes(routes!(health::health))
        .routes(routes!(health::meta))
        .merge(security::limit_per_ip(sign_in, security::AUTH_RATE_LIMIT))
        .routes(routes!(auth::handlers::logout))
        .routes(routes!(auth::handlers::logout_others))
        .routes(routes!(auth::handlers::me))
        .routes(routes!(auth::handlers::change_password))
        .routes(routes!(
            admin::handlers::list_invites,
            admin::handlers::create_invite
        ))
        .routes(routes!(admin::handlers::revoke_invite))
        .merge(sync_routes())
        .routes(routes!(
            audio::handlers::attach_audio,
            audio::handlers::remove_audio
        ))
        .routes(routes!(audio::handlers::get_audio))
        .routes(routes!(enrich::handlers::enrich))
        .routes(routes!(
            push::handlers::subscribe,
            push::handlers::unsubscribe
        ))
}

fn sync_routes() -> OpenApiRouter<Arc<AppState>> {
    let push = OpenApiRouter::new()
        .routes(routes!(sync::handlers::push))
        .layer(DefaultBodyLimit::max(sync::handlers::PUSH_BODY_LIMIT));
    let restore = OpenApiRouter::new()
        .routes(routes!(sync::handlers::restore))
        .layer(DefaultBodyLimit::max(sync::handlers::RESTORE_BODY_LIMIT));
    OpenApiRouter::new()
        .routes(routes!(sync::handlers::pull))
        .routes(routes!(sync::handlers::summary))
        .routes(routes!(sync::handlers::export))
        .merge(push)
        .merge(restore)
}

/// The OpenAPI spec, printed by the `openapi` subcommand and served at `/api/openapi.json`.
pub fn openapi() -> utoipa::openapi::OpenApi {
    api_routes().into_openapi()
}

/// The whole app. A request passes the layers from the outside in (architecture.md §5.2): request id → trace →
/// security headers → compression → timeout → Origin check → rate limit (sign-in routes only) → handler.
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
        .layer(middleware::from_fn_with_state(
            state.clone(),
            security::check_origin,
        ))
        .with_state(state);
    let app = with_timeout_and_compression(app);
    let app = with_security_headers(app);
    let app = with_request_tracing(app);

    if cfg!(debug_assertions) {
        // Dev only: lets tools on other origins read the API. Production is same-origin behind Caddy.
        app.layer(CorsLayer::permissive())
    } else {
        app
    }
}

fn with_timeout_and_compression(app: Router) -> Router {
    app.layer(TimeoutLayer::with_status_code(
        StatusCode::REQUEST_TIMEOUT,
        Duration::from_secs(30),
    ))
    .layer(CompressionLayer::new())
}

fn with_security_headers(app: Router) -> Router {
    security::security_headers()
        .into_iter()
        .fold(app, |app, (name, value)| {
            app.layer(SetResponseHeaderLayer::overriding(name, value))
        })
}

/// Every request gets an `x-request-id` (also returned in the response) and one log line on completion with
/// method, path, request id, status, latency and the hashed user id (recorded by `CurrentUser`). Paths are logged
/// without the query string.
fn with_request_tracing(app: Router) -> Router {
    let trace = TraceLayer::new_for_http()
        .make_span_with(|request: &axum::http::Request<Body>| {
            let request_id = request
                .headers()
                .get(REQUEST_ID)
                .and_then(|value| value.to_str().ok())
                .unwrap_or_default();
            tracing::info_span!(
                "request",
                method = %request.method(),
                path = %request.uri().path(),
                request_id,
                user = tracing::field::Empty,
                status = tracing::field::Empty,
                latency_ms = tracing::field::Empty,
            )
        })
        .on_response(
            |response: &axum::http::Response<_>, latency: Duration, span: &Span| {
                span.record("status", response.status().as_u16());
                span.record(
                    "latency_ms",
                    u64::try_from(latency.as_millis()).unwrap_or(u64::MAX),
                );
                tracing::info!("response");
            },
        );
    app.layer(PropagateRequestIdLayer::new(REQUEST_ID))
        .layer(trace)
        .layer(SetRequestIdLayer::new(REQUEST_ID, UuidV7RequestId))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{body::Body, http::Request};
    use http_body_util::BodyExt;
    use tower::ServiceExt;

    fn test_app(pool: SqlitePool) -> Router {
        router(Arc::new(AppState::new(pool, Config::default()).unwrap()))
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
    async fn meta_reports_version_and_default_features(pool: SqlitePool) {
        let (status, body) = get_json(test_app(pool), "/api/meta").await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["version"], env!("CARGO_PKG_VERSION"));
        assert_eq!(
            body["features"],
            serde_json::json!({ "tts": false, "commons": true, "enrich": false, "push": false })
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
