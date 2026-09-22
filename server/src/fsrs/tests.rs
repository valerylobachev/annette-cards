//! The optimize endpoint on generated review logs.

use std::sync::Arc;

use axum::{
    Router,
    body::Body,
    http::{Request, StatusCode, header},
};
use sqlx::SqlitePool;

use crate::{
    app,
    auth::users::User,
    clock::{DAY_MS, HOUR_MS},
    fsrs::{MIN_REVIEWS, PARAMETER_COUNT},
    security::FSRS_OPTIMIZATIONS_PER_HOUR,
    test_support::{ORIGIN, PASSWORD, TestResponse, create_user, login, send, test_state},
};

const START: i64 = 1_780_000_000_000;

/// `POST /api/fsrs/optimize` (no body).
fn optimize_request(cookie: &str) -> Request<Body> {
    Request::post("/api/fsrs/optimize")
        .header(header::ORIGIN, ORIGIN)
        .header(header::COOKIE, cookie)
        .body(Body::empty())
        .unwrap()
}

async fn optimize(app: &Router, email: &str) -> TestResponse {
    let cookie = login(app, email, PASSWORD).await;
    send(app, optimize_request(&cookie)).await
}

/// A small deterministic generator (no randomness in tests).
struct Lcg(u64);

impl Lcg {
    fn next(&mut self) -> u64 {
        self.0 = self
            .0
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1_442_695_040_888_963_407);
        self.0 >> 33
    }
}

/// Inserts `cards` cards of `user` with `reviews` answers each, spaced like a learner who mostly remembers: the
/// interval grows after Good or Easy and starts over after Again.
async fn add_history(pool: &SqlitePool, user: &User, cards: usize, reviews: usize) {
    let mut random = Lcg(cards as u64 * 31 + reviews as u64);
    let mut tx = pool.begin().await.unwrap();
    let deck = format!("deck-{}", user.id);
    sqlx::query("INSERT OR IGNORE INTO decks (id, user_id, name, target_lang, native_lang, directions, created_at, updated_at, updated_by, server_seq) VALUES (?, ?, 'English', 'en-GB', 'ru', 'both', 1, 1, 'd', 1)")
        .bind(&deck)
        .bind(&user.id)
        .execute(&mut *tx)
        .await
        .unwrap();
    for card in 0..cards {
        let card_id = format!("{}-card-{card}", user.id);
        sqlx::query("INSERT INTO cards (id, user_id, deck_id, front, back, created_at, updated_at, updated_by, server_seq) VALUES (?, ?, ?, 'word', 'слово', 1, 1, 'd', 1)")
            .bind(&card_id)
            .bind(&user.id)
            .bind(&deck)
            .execute(&mut *tx)
            .await
            .unwrap();
        let mut day = i64::try_from(random.next() % 30).unwrap();
        let mut interval = 1.0_f64;
        for review in 0..reviews {
            let roll = random.next() % 100;
            let rating: i32 = match roll {
                0..12 => 1,
                12..22 => 2,
                22..90 => 3,
                _ => 4,
            };
            let state = if review == 0 { 0 } else { 2 };
            add_log(
                &mut tx,
                &user.id,
                &card_id,
                i64::from(rating),
                START + day * DAY_MS + 10 * HOUR_MS,
                state,
                false,
            )
            .await;
            interval = if rating == 1 {
                1.0
            } else {
                interval * (1.5 + f64::from(rating)) / 2.0
            };
            day += interval.round().max(1.0) as i64;
        }
    }
    tx.commit().await.unwrap();
}

async fn add_log(
    tx: &mut sqlx::SqliteConnection,
    user_id: &str,
    card_id: &str,
    rating: i64,
    reviewed_at: i64,
    state_before: i64,
    practice: bool,
) {
    sqlx::query("INSERT INTO review_log (id, user_id, card_id, direction, rating, mode, state_before, reviewed_at, duration_ms, practice, updated_at, updated_by, server_seq) VALUES (?, ?, ?, 'forward', ?, 'swipe', ?, ?, 5000, ?, 1, 'd', 1)")
        .bind(uuid::Uuid::now_v7().to_string())
        .bind(user_id)
        .bind(card_id)
        .bind(rating)
        .bind(format!(r#"{{"state":{state_before}}}"#))
        .bind(reviewed_at)
        .bind(practice)
        .execute(&mut *tx)
        .await
        .unwrap();
}

#[sqlx::test]
async fn fewer_than_the_minimum_reviews_is_refused_with_the_count(pool: SqlitePool) {
    let app = crate::test_support::test_app(pool.clone());
    let anna = create_user(&pool, "anna@example.com", false).await;
    let other = create_user(&pool, "other@example.com", false).await;
    // 999 counted answers; practice, undone answers and another user's history do not count.
    add_history(&pool, &anna, 111, 9).await;
    add_history(&pool, &other, 120, 10).await;
    let mut conn = pool.acquire().await.unwrap();
    let card = format!("{}-card-0", anna.id);
    for i in 0..50 {
        add_log(&mut conn, &anna.id, &card, 3, START + i, 2, true).await;
    }
    add_log(&mut conn, &anna.id, &card, 3, START, 2, false).await;
    sqlx::query("UPDATE review_log SET deleted_at = 1 WHERE reviewed_at = ? AND practice = 0")
        .bind(START)
        .execute(&mut *conn)
        .await
        .unwrap();

    let response = optimize(&app, "anna@example.com").await;
    assert_eq!(response.status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(response.code(), "not_enough_reviews");
    assert_eq!(
        response.body["details"],
        serde_json::json!({ "count": 999, "required": MIN_REVIEWS })
    );
}

#[sqlx::test]
async fn enough_reviews_give_fsrs6_weights_and_losses(pool: SqlitePool) {
    let app = crate::test_support::test_app(pool.clone());
    let anna = create_user(&pool, "anna@example.com", false).await;
    add_history(&pool, &anna, 100, 12).await;

    let response = optimize(&app, "anna@example.com").await;
    assert_eq!(response.status, StatusCode::OK, "{}", response.body);
    let weights = response.body["weights"].as_array().unwrap();
    assert_eq!(weights.len(), PARAMETER_COUNT);
    assert!(
        weights
            .iter()
            .all(|w| w.as_f64().is_some_and(f64::is_finite))
    );
    assert_eq!(response.body["review_count"], 1200);
    for loss in ["log_loss_default", "log_loss_optimized"] {
        let value = response.body[loss].as_f64().unwrap();
        assert!(value.is_finite() && value > 0.0, "{loss} = {value}");
    }
}

#[sqlx::test]
async fn optimizations_are_limited_per_hour(pool: SqlitePool) {
    let state = test_state(pool.clone());
    let anna = create_user(&pool, "anna@example.com", false).await;
    add_history(&pool, &anna, 100, 10).await;
    for _ in 0..FSRS_OPTIMIZATIONS_PER_HOUR {
        state
            .fsrs_limit
            .check(&anna.id, crate::clock::now_ms())
            .unwrap();
    }
    let app = app::router(Arc::new(state));
    let response = optimize(&app, "anna@example.com").await;
    assert_eq!(response.status, StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(response.code(), "rate_limited");
}

#[sqlx::test]
async fn optimizing_needs_sign_in(pool: SqlitePool) {
    let app = crate::test_support::test_app(pool);
    let request = Request::post("/api/fsrs/optimize")
        .header(header::ORIGIN, ORIGIN)
        .body(Body::empty())
        .unwrap();
    assert_eq!(send(&app, request).await.status, StatusCode::UNAUTHORIZED);
}
