//! The enrichment flow and endpoint with a fake model (no test calls a real service).

use std::{
    collections::VecDeque,
    sync::{Arc, Mutex},
};

use async_trait::async_trait;
use axum::{Router, http::StatusCode};
use serde_json::json;
use sqlx::SqlitePool;

use crate::{
    app,
    clock::DAY_MS,
    enrich::{
        EnrichError, EnrichPrompt, Enricher,
        dto::{EnrichRequest, EnrichResponse},
        service,
    },
    error::AppError,
    security::ENRICH_REQUESTS_PER_MINUTE,
    test_support::{PASSWORD, create_user, get, login, post_json, send, test_state},
};

const VALID: &str = r#"{"back": "черепаха", "example": "Żółw jest powolny.",
    "example_translation": "Черепаха медленная.", "ipa": "/ʐuf/", "notes": "сущ., м. р."}"#;
/// 2026-09-21 12:00 UTC.
const NOON: i64 = 1_789_992_000_000;

/// Answers with queued results, the last one repeating, and records the prompts it got.
struct FakeEnricher {
    answers: Mutex<VecDeque<Result<String, EnrichError>>>,
    prompts: Mutex<Vec<EnrichPrompt>>,
}

impl FakeEnricher {
    fn new(answers: Vec<Result<&str, EnrichError>>) -> Arc<Self> {
        let answers = answers
            .into_iter()
            .map(|answer| answer.map(str::to_string))
            .collect();
        Arc::new(Self {
            answers: Mutex::new(answers),
            prompts: Mutex::new(Vec::new()),
        })
    }

    fn answering(text: &str) -> Arc<Self> {
        Self::new(vec![Ok(text)])
    }

    fn calls(&self) -> usize {
        self.prompts.lock().unwrap().len()
    }
}

#[async_trait]
impl Enricher for FakeEnricher {
    async fn complete(&self, prompt: &EnrichPrompt) -> Result<String, EnrichError> {
        self.prompts.lock().unwrap().push(prompt.clone());
        let mut answers = self.answers.lock().unwrap();
        if answers.len() > 1 {
            answers.pop_front().unwrap()
        } else {
            match answers.front().unwrap() {
                Ok(text) => Ok(text.clone()),
                Err(EnrichError::Timeout) => Err(EnrichError::Timeout),
                Err(EnrichError::Provider(message)) => Err(EnrichError::Provider(message.clone())),
            }
        }
    }
}

fn request(front: &str) -> EnrichRequest {
    EnrichRequest {
        front: front.to_string(),
        target_lang: "pl-PL".to_string(),
        native_lang: "ru".to_string(),
        context: None,
    }
}

async fn usage(pool: &SqlitePool, user_id: &str) -> i64 {
    sqlx::query_scalar!(
        "SELECT COALESCE(SUM(count), 0) AS \"total!: i64\" FROM enrich_usage WHERE user_id = ?",
        user_id
    )
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn run(
    pool: &SqlitePool,
    fake: &FakeEnricher,
    limit: u32,
    user_id: &str,
    now: i64,
) -> Result<EnrichResponse, AppError> {
    service::enrich(pool, fake, limit, user_id, &request("żółw"), now).await
}

#[sqlx::test]
async fn a_valid_answer_is_returned_and_counted(pool: SqlitePool) {
    let anna = create_user(&pool, "anna@example.com", false).await;
    let fake = FakeEnricher::answering(VALID);

    let suggestion = run(&pool, &fake, 200, &anna.id, NOON).await.unwrap();
    assert_eq!(suggestion.back, "черепаха");
    assert_eq!(suggestion.notes.as_deref(), Some("сущ., м. р."));
    assert_eq!(fake.calls(), 1);
    assert_eq!(fake.prompts.lock().unwrap()[0].user, "Word: żółw");
    assert_eq!(usage(&pool, &anna.id).await, 1);
}

#[sqlx::test]
async fn an_invalid_answer_is_retried_once_with_a_reminder(pool: SqlitePool) {
    let anna = create_user(&pool, "anna@example.com", false).await;
    let fake = FakeEnricher::new(vec![Ok("Sure! The word means turtle."), Ok(VALID)]);

    let suggestion = run(&pool, &fake, 200, &anna.id, NOON).await.unwrap();
    assert_eq!(suggestion.back, "черепаха");
    let prompts = fake.prompts.lock().unwrap().clone();
    assert_eq!(prompts.len(), 2);
    assert_eq!(prompts[1].system, prompts[0].system);
    assert!(prompts[1].user.contains("only the JSON object"));
    assert_eq!(usage(&pool, &anna.id).await, 1);
}

#[sqlx::test]
async fn two_invalid_answers_are_a_provider_error_and_not_counted(pool: SqlitePool) {
    let anna = create_user(&pool, "anna@example.com", false).await;
    let fake = FakeEnricher::answering(r#"{"example": "no back"}"#);

    let error = run(&pool, &fake, 200, &anna.id, NOON).await.unwrap_err();
    assert!(matches!(error, AppError::ProviderError), "{error:?}");
    assert_eq!(fake.calls(), 2);
    assert_eq!(usage(&pool, &anna.id).await, 0);
}

#[sqlx::test]
async fn provider_failures_are_not_retried(pool: SqlitePool) {
    let anna = create_user(&pool, "anna@example.com", false).await;

    let timeout = FakeEnricher::new(vec![Err(EnrichError::Timeout)]);
    let error = run(&pool, &timeout, 200, &anna.id, NOON).await.unwrap_err();
    assert!(matches!(error, AppError::ProviderTimeout), "{error:?}");
    assert_eq!(timeout.calls(), 1);

    let down = FakeEnricher::new(vec![Err(EnrichError::Provider("503".to_string()))]);
    let error = run(&pool, &down, 200, &anna.id, NOON).await.unwrap_err();
    assert!(matches!(error, AppError::ProviderError), "{error:?}");
    assert_eq!(down.calls(), 1);
    assert_eq!(usage(&pool, &anna.id).await, 0);
}

#[sqlx::test]
async fn the_daily_quota_is_per_user_and_resets_at_midnight_utc(pool: SqlitePool) {
    let anna = create_user(&pool, "anna@example.com", false).await;
    let boris = create_user(&pool, "boris@example.com", false).await;
    let fake = FakeEnricher::answering(VALID);

    run(&pool, &fake, 2, &anna.id, NOON).await.unwrap();
    run(&pool, &fake, 2, &anna.id, NOON + 1000).await.unwrap();
    let error = run(&pool, &fake, 2, &anna.id, NOON + 2000)
        .await
        .unwrap_err();
    assert!(matches!(error, AppError::EnrichQuotaExceeded), "{error:?}");
    assert_eq!(
        fake.calls(),
        2,
        "a refused request does not reach the model"
    );

    run(&pool, &fake, 2, &boris.id, NOON + 3000)
        .await
        .expect("another user has their own quota");

    // 23:59:59 is still the same day; 00:00 UTC is a new one.
    let midnight = NOON + DAY_MS / 2;
    assert!(
        run(&pool, &fake, 2, &anna.id, midnight - 1000)
            .await
            .is_err()
    );
    run(&pool, &fake, 2, &anna.id, midnight)
        .await
        .expect("the quota resets at 00:00 UTC");
}

fn app_with(pool: SqlitePool, enricher: Option<Arc<FakeEnricher>>, daily_limit: u32) -> Router {
    let mut state = test_state(pool);
    state.enricher = enricher.map(|fake| fake as Arc<dyn Enricher>);
    state.config.enrich_daily_limit = daily_limit;
    app::router(Arc::new(state))
}

fn body(front: &str) -> serde_json::Value {
    json!({ "front": front, "target_lang": "pl-PL", "native_lang": "ru" })
}

#[sqlx::test]
async fn enrich_returns_suggestions(pool: SqlitePool) {
    create_user(&pool, "anna@example.com", false).await;
    let fake = FakeEnricher::answering(VALID);
    let app = app_with(pool, Some(fake.clone()), 200);
    let cookie = login(&app, "anna@example.com", PASSWORD).await;

    let request =
        json!({ "front": " żółw ", "target_lang": "pl-PL", "native_lang": "ru", "context": "zoo" });
    let response = send(&app, post_json("/api/enrich", &request, Some(&cookie))).await;
    assert_eq!(response.status, StatusCode::OK, "{}", response.body);
    assert_eq!(
        response.body,
        json!({
            "back": "черепаха",
            "example": "Żółw jest powolny.",
            "example_translation": "Черепаха медленная.",
            "ipa": "/ʐuf/",
            "notes": "сущ., м. р.",
        })
    );
    assert_eq!(
        fake.prompts.lock().unwrap()[0].user,
        "Word: żółw\nContext: zoo"
    );
}

#[sqlx::test]
async fn enrich_needs_a_session(pool: SqlitePool) {
    let app = app_with(pool, Some(FakeEnricher::answering(VALID)), 200);
    let response = send(&app, post_json("/api/enrich", &body("kot"), None)).await;
    assert_eq!(response.status, StatusCode::UNAUTHORIZED);
    assert_eq!(response.code(), "unauthorized");
}

#[sqlx::test]
async fn enrich_without_a_key_is_disabled(pool: SqlitePool) {
    create_user(&pool, "anna@example.com", false).await;
    let app = app_with(pool, None, 200);
    let cookie = login(&app, "anna@example.com", PASSWORD).await;

    let response = send(&app, post_json("/api/enrich", &body("kot"), Some(&cookie))).await;
    assert_eq!(response.status, StatusCode::CONFLICT);
    assert_eq!(response.code(), "enrich_disabled");
}

#[sqlx::test]
async fn invalid_input_is_validation_failed(pool: SqlitePool) {
    create_user(&pool, "anna@example.com", false).await;
    let fake = FakeEnricher::answering(VALID);
    let app = app_with(pool, Some(fake.clone()), 200);
    let cookie = login(&app, "anna@example.com", PASSWORD).await;

    let bad = [
        body("  "),
        json!({ "front": "kot", "target_lang": "polish", "native_lang": "ru" }),
        json!({ "front": "kot" }),
    ];
    for request in bad {
        let response = send(&app, post_json("/api/enrich", &request, Some(&cookie))).await;
        assert_eq!(response.status, StatusCode::BAD_REQUEST, "{request}");
        assert_eq!(response.code(), "validation_failed");
    }
    assert_eq!(fake.calls(), 0);
}

#[sqlx::test]
async fn quota_and_provider_errors_have_their_codes(pool: SqlitePool) {
    create_user(&pool, "anna@example.com", false).await;
    let fake = FakeEnricher::new(vec![
        Ok(VALID),
        Err(EnrichError::Timeout),
        Ok("not json"),
        Ok("still not json"),
        Ok(VALID),
    ]);
    let app = app_with(pool, Some(fake), 2);
    let cookie = login(&app, "anna@example.com", PASSWORD).await;
    let post = async || send(&app, post_json("/api/enrich", &body("kot"), Some(&cookie))).await;

    assert_eq!(post().await.status, StatusCode::OK);
    let timeout = post().await;
    assert_eq!(timeout.status, StatusCode::GATEWAY_TIMEOUT);
    assert_eq!(timeout.code(), "provider_timeout");
    let invalid = post().await;
    assert_eq!(invalid.status, StatusCode::BAD_GATEWAY);
    assert_eq!(invalid.code(), "provider_error");
    assert_eq!(post().await.status, StatusCode::OK);
    let over = post().await;
    assert_eq!(over.status, StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(over.code(), "enrich_quota_exceeded");
}

#[sqlx::test]
async fn bursts_over_the_minute_limit_are_rate_limited(pool: SqlitePool) {
    create_user(&pool, "anna@example.com", false).await;
    let app = app_with(pool, Some(FakeEnricher::answering(VALID)), 1000);
    let cookie = login(&app, "anna@example.com", PASSWORD).await;

    for _ in 0..ENRICH_REQUESTS_PER_MINUTE {
        let response = send(&app, post_json("/api/enrich", &body("kot"), Some(&cookie))).await;
        assert_eq!(response.status, StatusCode::OK);
    }
    let response = send(&app, post_json("/api/enrich", &body("kot"), Some(&cookie))).await;
    assert_eq!(response.status, StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(response.code(), "rate_limited");
}

#[sqlx::test]
async fn meta_reports_enrich_when_a_model_is_configured(pool: SqlitePool) {
    let enabled = app_with(pool.clone(), Some(FakeEnricher::answering(VALID)), 200);
    let response = send(&enabled, get("/api/meta", None)).await;
    assert_eq!(response.body["features"]["enrich"], true);
    let disabled = app_with(pool, None, 200);
    let response = send(&disabled, get("/api/meta", None)).await;
    assert_eq!(response.body["features"]["enrich"], false);
}
