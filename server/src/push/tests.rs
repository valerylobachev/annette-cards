//! Subscriptions endpoints and the reminder rules, with a fake push sender (no test reaches a push service).

use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use axum::{Router, http::StatusCode};
use chrono::{TimeZone, Utc};
use chrono_tz::Europe::Riga;
use serde_json::{Value, json};
use sqlx::SqlitePool;

use crate::{
    app,
    config::Secret,
    push::{
        Delivery, PushError, PushSender, Subscription,
        reminders::{Reminded, ReminderSettings, send_reminders, study_day_start},
        store,
    },
    test_support::{PASSWORD, create_user, delete_json, get, login, post_json, send, test_state},
};

const APPLE: &str = "https://web.push.apple.com/QGuQyavXutnMH";
const P256DH: &str =
    "BLn9b-VR0ca83knDNZ32dCHGyjJp-1riX9ZTN40MqV8K_LpQmLqxC_DoHvqvFXO_nGdAB4W9dogZb_sM-uV4JbY";
const AUTH: &str = "_ordMnz7uTCmrpBTeUV4Bw";
const VAPID_PUBLIC: &str =
    "BOybS5X7a6I4xgXcfKoeQFoAJLi1DbYqUsLUi_RC5Vol7Wry68XfmT8fPAEo4bMabxjLF7OhKq5VchiAM42gd2Q";

/// Milliseconds of a UTC time.
fn utc(year: i32, month: u32, day: u32, hour: u32, minute: u32) -> i64 {
    Utc.with_ymd_and_hms(year, month, day, hour, minute, 0)
        .unwrap()
        .timestamp_millis()
}

/// 2026-07-15 20:00 in Riga (summer time, UTC+3).
fn riga_evening() -> i64 {
    utc(2026, 7, 15, 17, 0)
}

fn settings(value: Value) -> ReminderSettings {
    serde_json::from_value(value).unwrap()
}

fn is_reminder_due(settings: &ReminderSettings, now: i64) -> bool {
    settings.due_on(now).is_some()
}

fn evening_reminder() -> ReminderSettings {
    settings(
        json!({ "reminder": { "enabled": true, "time": "20:00", "tz": "Europe/Riga" }, "day_start_hour": 4 }),
    )
}

/// Records what it sends; endpoints listed in `gone` answer 410.
#[derive(Default)]
struct FakeSender {
    sent: Mutex<Vec<(String, Value)>>,
    gone: Vec<String>,
}

impl FakeSender {
    fn sent(&self) -> Vec<(String, Value)> {
        self.sent.lock().unwrap().clone()
    }
}

#[async_trait]
impl PushSender for FakeSender {
    async fn send(
        &self,
        subscription: &Subscription,
        payload: &[u8],
    ) -> Result<Delivery, PushError> {
        if self.gone.contains(&subscription.endpoint) {
            return Ok(Delivery::Gone);
        }
        let payload = serde_json::from_slice(payload).unwrap();
        self.sent
            .lock()
            .unwrap()
            .push((subscription.endpoint.clone(), payload));
        Ok(Delivery::Accepted)
    }
}

fn push_app(pool: SqlitePool) -> Router {
    let mut state = test_state(pool);
    state.push = Some(Arc::new(FakeSender::default()));
    state.config.vapid_public_key = Some(VAPID_PUBLIC.to_string());
    state.config.vapid_private_key = Some(Secret::new("private"));
    app::router(Arc::new(state))
}

fn subscription(endpoint: &str) -> Value {
    json!({ "endpoint": endpoint, "keys": { "p256dh": P256DH, "auth": AUTH } })
}

async fn subscriptions(pool: &SqlitePool) -> Vec<(String, String)> {
    sqlx::query_as("SELECT user_id, endpoint FROM push_subscriptions ORDER BY user_id")
        .fetch_all(pool)
        .await
        .unwrap()
}

// --- Endpoints ---

#[sqlx::test]
async fn meta_reports_push_with_the_public_key(pool: SqlitePool) {
    let response = send(&push_app(pool.clone()), get("/api/meta", None)).await;
    assert_eq!(response.body["features"]["push"], true);
    assert_eq!(response.body["vapid_public_key"], VAPID_PUBLIC);

    let response = send(&crate::test_support::test_app(pool), get("/api/meta", None)).await;
    assert_eq!(response.body["features"]["push"], false);
    assert_eq!(response.body["vapid_public_key"], Value::Null);
}

#[sqlx::test]
async fn subscribing_twice_keeps_one_row(pool: SqlitePool) {
    let app = push_app(pool.clone());
    create_user(&pool, "a@example.com", false).await;
    let cookie = login(&app, "a@example.com", PASSWORD).await;
    for _ in 0..2 {
        let response = send(
            &app,
            post_json("/api/push/subscribe", &subscription(APPLE), Some(&cookie)),
        )
        .await;
        assert_eq!(response.status, StatusCode::NO_CONTENT);
    }
    assert_eq!(subscriptions(&pool).await.len(), 1);
}

#[sqlx::test]
async fn an_endpoint_moves_to_the_account_that_subscribes_it(pool: SqlitePool) {
    let app = push_app(pool.clone());
    create_user(&pool, "a@example.com", false).await;
    let b = create_user(&pool, "b@example.com", false).await;
    let cookie_a = login(&app, "a@example.com", PASSWORD).await;
    let cookie_b = login(&app, "b@example.com", PASSWORD).await;
    send(
        &app,
        post_json("/api/push/subscribe", &subscription(APPLE), Some(&cookie_a)),
    )
    .await;
    send(
        &app,
        post_json("/api/push/subscribe", &subscription(APPLE), Some(&cookie_b)),
    )
    .await;
    assert_eq!(
        subscriptions(&pool).await,
        vec![(b.id.clone(), APPLE.to_string())]
    );

    let body = json!({ "endpoint": APPLE });
    let response = send(
        &app,
        delete_json("/api/push/subscribe", &body, Some(&cookie_a)),
    )
    .await;
    assert_eq!(
        response.status,
        StatusCode::NOT_FOUND,
        "A cannot delete B's subscription"
    );
    assert_eq!(subscriptions(&pool).await.len(), 1);
    let response = send(
        &app,
        delete_json("/api/push/subscribe", &body, Some(&cookie_b)),
    )
    .await;
    assert_eq!(response.status, StatusCode::NO_CONTENT);
    assert!(subscriptions(&pool).await.is_empty());
}

#[sqlx::test]
async fn subscriptions_are_validated_and_need_sign_in(pool: SqlitePool) {
    let app = push_app(pool.clone());
    create_user(&pool, "a@example.com", false).await;
    let cookie = login(&app, "a@example.com", PASSWORD).await;

    let response = send(
        &app,
        post_json("/api/push/subscribe", &subscription(APPLE), None),
    )
    .await;
    assert_eq!(response.status, StatusCode::UNAUTHORIZED);
    let other_host = subscription("https://attacker.example.com/push");
    let response = send(
        &app,
        post_json("/api/push/subscribe", &other_host, Some(&cookie)),
    )
    .await;
    assert_eq!(response.code(), "validation_failed");
    let short_auth = json!({ "endpoint": APPLE, "keys": { "p256dh": P256DH, "auth": "AAAA" } });
    let response = send(
        &app,
        post_json("/api/push/subscribe", &short_auth, Some(&cookie)),
    )
    .await;
    assert_eq!(response.code(), "validation_failed");
}

#[sqlx::test]
async fn subscribing_needs_push_enabled(pool: SqlitePool) {
    let app = crate::test_support::test_app(pool.clone());
    create_user(&pool, "a@example.com", false).await;
    let cookie = login(&app, "a@example.com", PASSWORD).await;
    let response = send(
        &app,
        post_json("/api/push/subscribe", &subscription(APPLE), Some(&cookie)),
    )
    .await;
    assert_eq!(response.status, StatusCode::CONFLICT);
    assert_eq!(response.code(), "push_disabled");
}

// --- Time rules ---

#[test]
fn the_reminder_fires_at_its_local_minute() {
    let reminder = evening_reminder();
    assert!(is_reminder_due(&reminder, riga_evening()));
    assert!(is_reminder_due(&reminder, riga_evening() + 59_000));
    assert!(!is_reminder_due(&reminder, utc(2026, 7, 15, 18, 0)));
    assert!(!is_reminder_due(&reminder, utc(2026, 7, 15, 16, 59)));

    let off =
        settings(json!({ "reminder": { "enabled": false, "time": "20:00", "tz": "Europe/Riga" } }));
    assert!(!is_reminder_due(&off, riga_evening()));
    let unknown_zone =
        settings(json!({ "reminder": { "enabled": true, "time": "20:00", "tz": "Mars/Base" } }));
    assert!(!is_reminder_due(&unknown_zone, riga_evening()));
}

#[test]
fn the_reminder_fires_once_on_dst_change_days() {
    let reminder = evening_reminder();
    for (month, day, expected) in [
        (3, 29, utc(2026, 3, 29, 17, 0)),
        (10, 25, utc(2026, 10, 25, 18, 0)),
    ] {
        let due: Vec<i64> = (0..24 * 60)
            .map(|minute| utc(2026, month, day, 0, 0) + minute * 60_000)
            .filter(|&now| is_reminder_due(&reminder, now))
            .collect();
        assert_eq!(due, vec![expected], "2026-{month}-{day}");
    }
}

#[test]
fn the_study_day_starts_at_the_day_start_hour() {
    // 20:00 in Riga starts at 04:00 the same day; 02:00 still belongs to the previous day.
    assert_eq!(
        study_day_start(riga_evening(), Riga, 4),
        utc(2026, 7, 15, 1, 0)
    );
    assert_eq!(
        study_day_start(utc(2026, 7, 14, 23, 0), Riga, 4),
        utc(2026, 7, 14, 1, 0)
    );
    assert_eq!(
        study_day_start(riga_evening(), Riga, 0),
        utc(2026, 7, 14, 21, 0)
    );
    // Riga skips 03:00–04:00 on 2026-03-29: a 03:00 start moves to 04:00 local (01:00 UTC).
    assert_eq!(
        study_day_start(utc(2026, 3, 29, 12, 0), Riga, 3),
        utc(2026, 3, 29, 1, 0)
    );
}

// --- Selection (database) ---

struct Learner {
    id: String,
}

/// A user with reminders at 20:00 Riga, one subscription and a deck with one card due for review.
async fn learner(pool: &SqlitePool, email: &str) -> Learner {
    let user = create_user(pool, email, false).await;
    let id = user.id;
    let data = evening_reminder_json(true);
    exec(pool, "INSERT INTO user_settings (user_id, data, updated_at, updated_by, server_seq) VALUES (?, ?, 1, 'd', 1)", &[&id, &data]).await;
    let deck = format!("deck-{id}");
    exec(pool, "INSERT INTO decks (id, user_id, name, target_lang, native_lang, directions, created_at, updated_at, updated_by, server_seq) VALUES (?, ?, 'English', 'en-GB', 'ru', 'forward', 1, 1, 'd', 1)", &[&deck, &id]).await;
    add_card(pool, &id, &deck, "card", 2).await;
    let subscription =
        json!({ "endpoint": format!("{APPLE}-{id}"), "keys": { "p256dh": P256DH, "auth": AUTH } });
    store::upsert(pool, &id, &serde_json::from_value(subscription).unwrap(), 1)
        .await
        .unwrap();
    Learner { id }
}

fn evening_reminder_json(enabled: bool) -> String {
    json!({ "reminder": { "enabled": enabled, "time": "20:00", "tz": "Europe/Riga" }, "day_start_hour": 4 })
        .to_string()
}

/// A card with a forward state due a day before the evening.
async fn add_card(pool: &SqlitePool, user_id: &str, deck_id: &str, name: &str, state: i64) {
    let card = format!("{name}-{user_id}");
    exec(pool, "INSERT INTO cards (id, user_id, deck_id, front, back, created_at, updated_at, updated_by, server_seq) VALUES (?, ?, ?, 'cat', 'кот', 1, 1, 'd', 1)", &[&card, user_id, deck_id]).await;
    let due = (riga_evening() - 86_400_000).to_string();
    sqlx::query("INSERT INTO card_states (card_id, direction, user_id, state, due, stability, difficulty, elapsed_days, scheduled_days, learning_steps, reps, lapses, updated_at, updated_by, server_seq) VALUES (?, 'forward', ?, ?, ?, 1, 5, 1, 1, 0, 1, 0, 1, 'd', 1)")
        .bind(&card)
        .bind(user_id)
        .bind(state)
        .bind(due.parse::<i64>().unwrap())
        .execute(pool)
        .await
        .unwrap();
}

async fn add_log(pool: &SqlitePool, user_id: &str, reviewed_at: i64, deleted: bool) {
    let id = uuid::Uuid::now_v7().to_string();
    sqlx::query("INSERT INTO review_log (id, user_id, card_id, direction, rating, mode, state_before, reviewed_at, duration_ms, updated_at, updated_by, deleted_at, server_seq) VALUES (?, ?, ?, 'forward', 3, 'swipe', '{}', ?, 1000, 1, 'd', ?, 1)")
        .bind(id)
        .bind(user_id)
        .bind(format!("card-{user_id}"))
        .bind(reviewed_at)
        .bind(deleted.then_some(reviewed_at))
        .execute(pool)
        .await
        .unwrap();
}

async fn exec(pool: &SqlitePool, sql: &'static str, args: &[&str]) {
    let mut query = sqlx::query(sql);
    for arg in args {
        query = query.bind(*arg);
    }
    query.execute(pool).await.unwrap();
}

async fn run(pool: &SqlitePool, sender: &FakeSender, now: i64) -> usize {
    send_reminders(pool, sender, now, &mut Reminded::new())
        .await
        .unwrap()
}

#[sqlx::test]
async fn due_cards_and_no_study_today_send_the_count(pool: SqlitePool) {
    let learner = learner(&pool, "a@example.com").await;
    let sender = FakeSender::default();
    assert_eq!(run(&pool, &sender, riga_evening()).await, 1);
    assert_eq!(
        sender.sent(),
        vec![(
            format!("{APPLE}-{}", learner.id),
            json!({ "type": "reminder", "due": 1 })
        )]
    );
    assert_eq!(
        run(&pool, &sender, riga_evening() + 60_000).await,
        0,
        "20:01 is not the reminder time"
    );
}

#[sqlx::test]
async fn an_answer_since_the_study_day_start_means_no_reminder(pool: SqlitePool) {
    let learner = learner(&pool, "a@example.com").await;
    let sender = FakeSender::default();
    // 03:30 local belongs to the previous study day; an undone answer does not count.
    add_log(&pool, &learner.id, utc(2026, 7, 15, 0, 30), false).await;
    add_log(&pool, &learner.id, utc(2026, 7, 15, 10, 0), true).await;
    assert_eq!(run(&pool, &sender, riga_evening()).await, 1);
    // 04:30 local is today.
    add_log(&pool, &learner.id, utc(2026, 7, 15, 1, 30), false).await;
    assert_eq!(run(&pool, &sender, riga_evening()).await, 0);
}

#[sqlx::test]
async fn only_review_cards_of_active_decks_count(pool: SqlitePool) {
    let learner = learner(&pool, "a@example.com").await;
    let sender = FakeSender::default();
    exec(
        &pool,
        "UPDATE card_states SET deleted_at = 1 WHERE user_id = ?",
        &[&learner.id],
    )
    .await;
    let deck = format!("deck-{}", learner.id);
    add_card(&pool, &learner.id, &deck, "new", 0).await;
    assert_eq!(
        run(&pool, &sender, riga_evening()).await,
        0,
        "New cards are not reviews"
    );

    exec(
        &pool,
        "UPDATE card_states SET deleted_at = NULL, state = 2 WHERE user_id = ?",
        &[&learner.id],
    )
    .await;
    exec(
        &pool,
        "UPDATE decks SET archived_at = 1 WHERE user_id = ?",
        &[&learner.id],
    )
    .await;
    assert_eq!(
        run(&pool, &sender, riga_evening()).await,
        0,
        "archived deck"
    );

    exec(
        &pool,
        "UPDATE decks SET archived_at = NULL, directions = 'reverse' WHERE user_id = ?",
        &[&learner.id],
    )
    .await;
    assert_eq!(
        run(&pool, &sender, riga_evening()).await,
        0,
        "direction not studied"
    );

    exec(
        &pool,
        "UPDATE decks SET directions = 'both' WHERE user_id = ?",
        &[&learner.id],
    )
    .await;
    assert_eq!(run(&pool, &sender, riga_evening()).await, 1);
    assert_eq!(sender.sent()[0].1["due"], 2);
}

#[sqlx::test]
async fn reminders_turned_off_are_not_sent(pool: SqlitePool) {
    let learner = learner(&pool, "a@example.com").await;
    let data = evening_reminder_json(false);
    exec(
        &pool,
        "UPDATE user_settings SET data = ? WHERE user_id = ?",
        &[&data, &learner.id],
    )
    .await;
    assert_eq!(run(&pool, &FakeSender::default(), riga_evening()).await, 0);
}

#[sqlx::test]
async fn one_users_answers_do_not_affect_another(pool: SqlitePool) {
    let a = learner(&pool, "a@example.com").await;
    let b = learner(&pool, "b@example.com").await;
    add_log(&pool, &a.id, utc(2026, 7, 15, 10, 0), false).await;
    let sender = FakeSender::default();
    assert_eq!(run(&pool, &sender, riga_evening()).await, 1);
    assert_eq!(sender.sent()[0].0, format!("{APPLE}-{}", b.id));
}

#[sqlx::test]
async fn a_gone_subscription_is_deleted(pool: SqlitePool) {
    let learner = learner(&pool, "a@example.com").await;
    let sender = FakeSender {
        gone: vec![format!("{APPLE}-{}", learner.id)],
        ..FakeSender::default()
    };
    assert_eq!(run(&pool, &sender, riga_evening()).await, 0);
    assert!(subscriptions(&pool).await.is_empty());
}

#[sqlx::test]
async fn a_repeated_minute_reminds_once(pool: SqlitePool) {
    learner(&pool, "a@example.com").await;
    let sender = FakeSender::default();
    let mut reminded = Reminded::new();
    for now in [riga_evening(), riga_evening() + 30_000] {
        send_reminders(&pool, &sender, now, &mut reminded)
            .await
            .unwrap();
    }
    assert_eq!(sender.sent().len(), 1);
}
