//! Push service and router tests.

use axum::http::StatusCode;
use serde_json::json;
use sqlx::{AssertSqlSafe, SqlitePool};

use crate::{
    sync::{
        dto::{CardDto, Changes, DeckDto, Direction, PushResponse, ReviewLogDto, SettingsDto},
        push::push,
        test_rows::{card_row, deck_row, log_row, state_row},
    },
    test_support::{PASSWORD, create_user, login, post_json, send, test_app},
};

const NOW: i64 = 1_758_441_600_000;

async fn user(pool: &SqlitePool, email: &str) -> String {
    create_user(pool, email, false).await.id
}

async fn push_as(pool: &SqlitePool, user_id: &str, changes: Changes) -> PushResponse {
    push(pool, user_id, &changes, NOW).await.unwrap()
}

async fn seq_of(pool: &SqlitePool, table: &str, id: &str) -> i64 {
    let key = if table == "card_states" {
        "card_id"
    } else {
        "id"
    };
    sqlx::query_scalar(AssertSqlSafe(format!(
        "SELECT server_seq FROM {table} WHERE {key} = ?"
    )))
    .bind(id)
    .fetch_one(pool)
    .await
    .unwrap()
}

fn only_decks(decks: Vec<DeckDto>) -> Changes {
    Changes {
        decks,
        ..Changes::default()
    }
}

fn only_cards(cards: Vec<CardDto>) -> Changes {
    Changes {
        cards,
        ..Changes::default()
    }
}

fn only_review_log(review_log: Vec<ReviewLogDto>) -> Changes {
    Changes {
        review_log,
        ..Changes::default()
    }
}

fn only_settings(settings: SettingsDto) -> Changes {
    Changes {
        settings: Some(settings),
        ..Changes::default()
    }
}

fn one_deck_with_a_card() -> Changes {
    Changes {
        decks: vec![deck_row("d1", 10)],
        cards: vec![card_row("c1", "d1", 10)],
        ..Changes::default()
    }
}

#[sqlx::test]
async fn a_new_deck_with_cards_states_and_a_log_is_applied_in_dependency_order(pool: SqlitePool) {
    let anna = user(&pool, "anna@example.com").await;
    let mut reverse = state_row("c1", 10);
    reverse.direction = Direction::Reverse;
    // Rows arrive in entity lists; within the request the server applies decks first, whatever the JSON order.
    let changes = Changes {
        review_log: vec![log_row("l1", "c1")],
        card_states: vec![state_row("c1", 10), reverse],
        cards: vec![card_row("c1", "d1", 10)],
        decks: vec![deck_row("d1", 10)],
        settings: None,
    };

    let response = push_as(&pool, &anna, changes).await;
    assert_eq!(response.applied.decks, ["d1"]);
    assert_eq!(response.applied.cards, ["c1"]);
    assert_eq!(response.applied.card_states, ["c1:forward", "c1:reverse"]);
    assert_eq!(response.applied.review_log, ["l1"]);
    assert!(response.rejected.is_empty());
    assert_eq!(response.server_time, NOW);

    let deck = seq_of(&pool, "decks", "d1").await;
    let card = seq_of(&pool, "cards", "c1").await;
    let log = seq_of(&pool, "review_log", "l1").await;
    let states: Vec<i64> =
        sqlx::query_scalar("SELECT server_seq FROM card_states ORDER BY server_seq")
            .fetch_all(&pool)
            .await
            .unwrap();
    assert!(deck < card && card < states[0] && states[0] < states[1] && states[1] < log);

    let owner: String = sqlx::query_scalar("SELECT user_id FROM cards WHERE id = 'c1'")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(owner, anna);
    let tags: String = sqlx::query_scalar("SELECT tags FROM cards WHERE id = 'c1'")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(tags, r#"["verbs"]"#);
}

#[sqlx::test]
async fn rows_of_other_users_are_rejected(pool: SqlitePool) {
    let anna = user(&pool, "anna@example.com").await;
    let bob = user(&pool, "bob@example.com").await;
    push_as(&pool, &anna, one_deck_with_a_card()).await;

    let changes = Changes {
        // Same ids as Anna's rows, even with a newer stamp.
        decks: vec![deck_row("d1", 99)],
        cards: vec![card_row("c1", "d1", 99), card_row("c2", "d1", 99)],
        card_states: vec![state_row("c1", 99)],
        review_log: vec![log_row("l1", "c1")],
        settings: None,
    };
    let response = push_as(&pool, &bob, changes).await;
    let rejected: Vec<(String, String)> = response
        .rejected
        .iter()
        .map(|row| (row.id.clone(), row.code.clone()))
        .collect();
    assert_eq!(
        rejected,
        [
            ("d1".into(), "not_owned".into()),
            ("c1".into(), "not_owned".into()),
            ("c2".into(), "deck_not_owned".into()),
            ("c1:forward".into(), "card_not_owned".into()),
            ("l1".into(), "card_not_owned".into()),
        ]
    );
    assert_eq!(response.applied, Default::default());

    let name: String = sqlx::query_scalar("SELECT name FROM decks WHERE id = 'd1'")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(name, "Deck d1");
}

#[sqlx::test]
async fn a_card_may_reference_a_deck_from_the_same_batch_but_not_a_missing_one(pool: SqlitePool) {
    let anna = user(&pool, "anna@example.com").await;
    let changes = Changes {
        decks: vec![deck_row("d1", 10)],
        cards: vec![card_row("c1", "d1", 10), card_row("c2", "missing", 10)],
        ..Changes::default()
    };
    let response = push_as(&pool, &anna, changes).await;
    assert_eq!(response.applied.cards, ["c1"]);
    assert_eq!(response.rejected[0].id, "c2");
    assert_eq!(response.rejected[0].code, "deck_not_owned");
}

#[sqlx::test]
async fn last_write_wins(pool: SqlitePool) {
    let anna = user(&pool, "anna@example.com").await;
    push_as(&pool, &anna, one_deck_with_a_card()).await;
    let first_seq = seq_of(&pool, "cards", "c1").await;

    let mut older = card_row("c1", "d1", 9);
    older.front = "older".into();
    let response = push_as(&pool, &anna, only_cards(vec![older])).await;
    assert_eq!(response.skipped.cards, ["c1"]);
    assert_eq!(seq_of(&pool, "cards", "c1").await, first_seq);

    let mut newer = card_row("c1", "d1", 11);
    newer.front = "newer".into();
    let response = push_as(&pool, &anna, only_cards(vec![newer])).await;
    assert_eq!(response.applied.cards, ["c1"]);
    assert!(seq_of(&pool, "cards", "c1").await > first_seq);

    // Same timestamp: the larger device id wins, the smaller one loses.
    let mut tie_small = card_row("c1", "d1", 11);
    tie_small.updated_by = "device-0".into();
    tie_small.front = "tie small".into();
    let mut tie_large = card_row("c1", "d1", 11);
    tie_large.updated_by = "device-z".into();
    tie_large.front = "tie large".into();
    let response = push_as(&pool, &anna, only_cards(vec![tie_small])).await;
    assert_eq!(response.skipped.cards, ["c1"]);
    let response = push_as(&pool, &anna, only_cards(vec![tie_large])).await;
    assert_eq!(response.applied.cards, ["c1"]);

    let front: String = sqlx::query_scalar("SELECT front FROM cards WHERE id = 'c1'")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(front, "tie large");

    // Re-pushing the stored row is a no-op.
    let mut same = card_row("c1", "d1", 11);
    same.updated_by = "device-z".into();
    let response = push_as(&pool, &anna, only_cards(vec![same])).await;
    assert_eq!(response.skipped.cards, ["c1"]);
}

#[sqlx::test]
async fn review_log_is_append_only_except_for_undo(pool: SqlitePool) {
    let anna = user(&pool, "anna@example.com").await;
    let mut changes = one_deck_with_a_card();
    let mut practice = log_row("l2", "c1");
    practice.practice = true;
    changes.review_log = vec![log_row("l1", "c1"), practice];
    push_as(&pool, &anna, changes).await;
    let first_seq = seq_of(&pool, "review_log", "l1").await;

    let again = push_as(&pool, &anna, only_review_log(vec![log_row("l1", "c1")])).await;
    assert_eq!(again.skipped.review_log, ["l1"]);

    let mut changed = log_row("l1", "c1");
    changed.rating = 1;
    changed.updated_at = 5_000;
    let changed = push_as(&pool, &anna, only_review_log(vec![changed])).await;
    assert_eq!(changed.skipped.review_log, ["l1"]);

    let mut undo = log_row("l1", "c1");
    undo.rating = 1; // ignored: only deleted_at is taken over
    undo.deleted_at = Some(6_000);
    undo.updated_at = 6_000;
    let undone = push_as(&pool, &anna, only_review_log(vec![undo.clone()])).await;
    assert_eq!(undone.applied.review_log, ["l1"]);
    assert!(seq_of(&pool, "review_log", "l1").await > first_seq);

    let row = sqlx::query!(
        r#"SELECT rating, deleted_at, practice AS "practice: bool" FROM review_log WHERE id = 'l1'"#
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        (row.rating, row.deleted_at, row.practice),
        (3, Some(6_000), false)
    );

    let twice = push_as(&pool, &anna, only_review_log(vec![undo])).await;
    assert_eq!(twice.skipped.review_log, ["l1"]);

    let practice: bool = sqlx::query_scalar("SELECT practice FROM review_log WHERE id = 'l2'")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!(practice);
}

#[sqlx::test]
async fn a_soft_delete_is_an_ordinary_update(pool: SqlitePool) {
    let anna = user(&pool, "anna@example.com").await;
    push_as(&pool, &anna, one_deck_with_a_card()).await;

    let mut deleted = deck_row("d1", 20);
    deleted.deleted_at = Some(20);
    let response = push_as(&pool, &anna, only_decks(vec![deleted])).await;
    assert_eq!(response.applied.decks, ["d1"]);
    let deleted_at: Option<i64> =
        sqlx::query_scalar("SELECT deleted_at FROM decks WHERE id = 'd1'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(deleted_at, Some(20));
}

#[sqlx::test]
async fn settings_follow_last_write_wins(pool: SqlitePool) {
    let anna = user(&pool, "anna@example.com").await;
    let settings = |updated_at, new_per_day| SettingsDto {
        data: json!({ "new_per_day": new_per_day }),
        updated_at,
        updated_by: "device-a".into(),
    };

    let first = push_as(&pool, &anna, only_settings(settings(10, 20))).await;
    assert!(first.applied.settings);
    let older = push_as(&pool, &anna, only_settings(settings(5, 30))).await;
    assert!(!older.applied.settings);
    assert!(older.skipped.settings);
    let newer = push_as(&pool, &anna, only_settings(settings(15, 25))).await;
    assert!(newer.applied.settings);

    let data: String = sqlx::query_scalar("SELECT data FROM user_settings WHERE user_id = ?")
        .bind(&anna)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(data, r#"{"new_per_day":25}"#);
}

#[sqlx::test]
async fn invalid_rows_are_rejected_and_the_rest_applies(pool: SqlitePool) {
    let anna = user(&pool, "anna@example.com").await;
    let mut long = card_row("c2", "d1", 10);
    long.front = "x".repeat(501);
    let mut changes = one_deck_with_a_card();
    changes.cards.push(long);

    let response = push_as(&pool, &anna, changes).await;
    assert_eq!(response.applied.cards, ["c1"]);
    assert_eq!(response.rejected.len(), 1);
    assert_eq!(response.rejected[0].code, "validation_failed");
    assert_eq!(
        serde_json::to_value(&response.rejected[0]).unwrap()["entity"],
        "cards"
    );
}

#[sqlx::test]
async fn more_than_500_rows_is_a_bad_request(pool: SqlitePool) {
    let anna = user(&pool, "anna@example.com").await;
    let changes = Changes {
        decks: (0..501).map(|i| deck_row(&format!("d{i}"), 1)).collect(),
        ..Changes::default()
    };
    assert!(push(&pool, &anna, &changes, NOW).await.is_err());
}

#[sqlx::test]
async fn the_push_route_needs_a_session_and_limits_the_body(pool: SqlitePool) {
    create_user(&pool, "anna@example.com", false).await;
    let app = test_app(pool);
    let body = json!({ "device_id": "device-a", "changes": { "decks": [deck_row("d1", 10)] } });

    let anonymous = send(&app, post_json("/api/sync/push", &body, None)).await;
    assert_eq!(anonymous.status, StatusCode::UNAUTHORIZED);

    let cookie = login(&app, "anna@example.com", PASSWORD).await;
    let ok = send(&app, post_json("/api/sync/push", &body, Some(&cookie))).await;
    assert_eq!(ok.status, StatusCode::OK);
    assert_eq!(ok.body["applied"]["decks"], json!(["d1"]));
    assert_eq!(ok.body["skipped"]["cards"], json!([]));
    assert_eq!(ok.body["applied"]["settings"], false);

    let huge = json!({ "device_id": "device-a", "changes": { "decks": [], "padding": "x".repeat(2 * 1024 * 1024) } });
    let too_large = send(&app, post_json("/api/sync/push", &huge, Some(&cookie))).await;
    assert_eq!(too_large.status, StatusCode::PAYLOAD_TOO_LARGE);
    assert_eq!(
        too_large.body,
        json!({ "code": "payload_too_large", "details": null })
    );

    let malformed = json!({ "device_id": "device-a", "changes": { "decks": [{ "id": "d2" }] } });
    let bad = send(&app, post_json("/api/sync/push", &malformed, Some(&cookie))).await;
    assert_eq!(bad.status, StatusCode::BAD_REQUEST);
    assert_eq!(bad.code(), "validation_failed");
}

#[test]
fn the_architecture_example_payload_parses() {
    let request: crate::sync::dto::PushRequest = serde_json::from_value(json!({
        "device_id": "0192f6c1-0000-7000-8000-000000000000",
        "changes": {
            "decks": [{ "id": "0192f6c1-0000-7000-8000-000000000001", "name": "English B2", "target_lang": "en-GB",
                        "native_lang": "ru", "directions": "both", "new_per_day": null, "archived_at": null,
                        "created_at": 1758441600000_i64, "updated_at": 1758441600000_i64,
                        "updated_by": "0192f6c1-0000-7000-8000-000000000000", "deleted_at": null }],
            "cards": [],
            "card_states": [],
            "review_log": [],
            "settings": null
        }
    }))
    .unwrap();
    assert_eq!(request.changes.decks[0].name, "English B2");
    let roundtrip = serde_json::to_value(&request.changes).unwrap();
    assert_eq!(roundtrip["decks"][0]["directions"], "both");
    assert_eq!(roundtrip["settings"], serde_json::Value::Null);
}
