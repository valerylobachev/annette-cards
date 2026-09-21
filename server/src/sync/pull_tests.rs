//! Pull, summary, export and restore tests.

use std::collections::HashSet;

use axum::http::{StatusCode, header};
use serde_json::json;
use sqlx::SqlitePool;

use crate::{
    sync::{
        backup::{self, BACKUP_FORMAT},
        dto::{Changes, PullResponse, SettingsDto},
        pull::pull,
        push::push,
        test_rows::{card_row, deck_row, log_row, state_row},
    },
    test_support::{PASSWORD, create_user, get, login, post_json, send, test_app},
};

const NOW: i64 = 1_758_441_600_000;

async fn user(pool: &SqlitePool, email: &str) -> String {
    create_user(pool, email, false).await.id
}

async fn push_ok(pool: &SqlitePool, user_id: &str, changes: Changes) {
    let response = push(pool, user_id, &changes, NOW).await.unwrap();
    assert!(response.rejected.is_empty(), "{:?}", response.rejected);
}

/// Every row key of a page, e.g. `deck:d1`, `state:c1:forward`.
fn keys(page: &PullResponse) -> Vec<String> {
    let changes = &page.changes;
    let mut keys: Vec<String> = changes
        .decks
        .iter()
        .map(|row| format!("deck:{}", row.id))
        .collect();
    keys.extend(changes.cards.iter().map(|row| format!("card:{}", row.id)));
    keys.extend(
        changes
            .card_states
            .iter()
            .map(|row| format!("state:{}", row.key())),
    );
    keys.extend(
        changes
            .review_log
            .iter()
            .map(|row| format!("log:{}", row.id)),
    );
    keys.extend(changes.settings.iter().map(|_| "settings".to_string()));
    keys
}

/// A deck with one card, its forward state and one answer.
fn small_account() -> Changes {
    Changes {
        decks: vec![deck_row("d1", 10)],
        cards: vec![card_row("c1", "d1", 10)],
        card_states: vec![state_row("c1", 10)],
        review_log: vec![log_row("l1", "c1")],
        settings: Some(SettingsDto {
            data: json!({ "new_per_day": 25, "ui_language": "en" }),
            updated_at: 10,
            updated_by: "device-a".into(),
        }),
    }
}

#[sqlx::test]
async fn an_empty_account_pulls_nothing(pool: SqlitePool) {
    let anna = user(&pool, "anna@example.com").await;
    let page = pull(&pool, &anna, 42, 500).await.unwrap();
    assert_eq!(page.changes, Changes::default());
    assert_eq!(page.cursor, 42);
    assert!(!page.has_more);
}

#[sqlx::test]
async fn pages_cover_every_row_once_in_server_seq_order(pool: SqlitePool) {
    let anna = user(&pool, "anna@example.com").await;
    let decks: Vec<_> = (0..100).map(|d| deck_row(&format!("d{d}"), 1)).collect();
    let cards: Vec<_> = (0..500)
        .map(|c| card_row(&format!("c{c}"), &format!("d{}", c % 100), 1))
        .collect();
    let states: Vec<_> = (0..500).map(|c| state_row(&format!("c{c}"), 1)).collect();
    let logs: Vec<_> = (0..100)
        .map(|l| log_row(&format!("l{l}"), &format!("c{l}")))
        .collect();
    push_ok(
        &pool,
        &anna,
        Changes {
            decks,
            ..Changes::default()
        },
    )
    .await;
    push_ok(
        &pool,
        &anna,
        Changes {
            cards,
            ..Changes::default()
        },
    )
    .await;
    push_ok(
        &pool,
        &anna,
        Changes {
            card_states: states,
            ..Changes::default()
        },
    )
    .await;
    push_ok(
        &pool,
        &anna,
        Changes {
            review_log: logs,
            ..Changes::default()
        },
    )
    .await;

    let mut cursor = 0;
    let mut seen = HashSet::new();
    let mut page_sizes = Vec::new();
    loop {
        let page = pull(&pool, &anna, cursor, 500).await.unwrap();
        assert!(page.cursor > cursor, "the cursor moves forward");
        let page_keys = keys(&page);
        page_sizes.push(page_keys.len());
        for key in page_keys {
            assert!(seen.insert(key.clone()), "{key} pulled twice");
        }
        cursor = page.cursor;
        if !page.has_more {
            break;
        }
    }
    assert_eq!(page_sizes, [500, 500, 200]);
    assert_eq!(seen.len(), 1200);
    // Pushes allocated 1200 consecutive sequence numbers; the last cursor is the last of them.
    assert_eq!(cursor, 1200);

    let after = pull(&pool, &anna, cursor, 500).await.unwrap();
    assert_eq!(keys(&after), Vec::<String>::new());
    assert!(!after.has_more);
}

#[sqlx::test]
async fn the_limit_is_clamped(pool: SqlitePool) {
    let anna = user(&pool, "anna@example.com").await;
    push_ok(&pool, &anna, small_account()).await;
    let page = pull(&pool, &anna, 0, 0).await.unwrap();
    assert_eq!(keys(&page), ["deck:d1"]);
    assert!(page.has_more);
}

#[sqlx::test]
async fn an_update_is_pulled_again_after_the_cursor(pool: SqlitePool) {
    let anna = user(&pool, "anna@example.com").await;
    push_ok(&pool, &anna, small_account()).await;
    let first = pull(&pool, &anna, 0, 500).await.unwrap();
    assert_eq!(
        first.changes.settings.as_ref().unwrap().data["new_per_day"],
        25
    );
    assert!(!first.changes.review_log[0].practice);

    let mut renamed = card_row("c1", "d1", 20);
    renamed.front = "renamed".into();
    let mut deleted = deck_row("d1", 20);
    deleted.deleted_at = Some(20);
    push_ok(
        &pool,
        &anna,
        Changes {
            decks: vec![deleted],
            cards: vec![renamed],
            ..Changes::default()
        },
    )
    .await;

    let second = pull(&pool, &anna, first.cursor, 500).await.unwrap();
    assert_eq!(keys(&second), ["deck:d1", "card:c1"]);
    assert_eq!(
        second.changes.decks[0].deleted_at,
        Some(20),
        "soft-deleted rows are pulled"
    );
    assert_eq!(second.changes.cards[0].front, "renamed");
    assert!(second.cursor > first.cursor);
}

#[sqlx::test]
async fn pull_returns_only_the_users_rows(pool: SqlitePool) {
    let anna = user(&pool, "anna@example.com").await;
    let bob = user(&pool, "bob@example.com").await;
    push_ok(&pool, &anna, small_account()).await;
    let mut bobs = small_account();
    bobs.decks = vec![deck_row("bob-deck", 10)];
    bobs.cards = vec![card_row("bob-card", "bob-deck", 10)];
    bobs.card_states = vec![state_row("bob-card", 10)];
    bobs.review_log = vec![log_row("bob-log", "bob-card")];
    push_ok(&pool, &bob, bobs).await;

    let page = pull(&pool, &bob, 0, 500).await.unwrap();
    assert_eq!(
        keys(&page),
        [
            "deck:bob-deck",
            "card:bob-card",
            "state:bob-card:forward",
            "log:bob-log",
            "settings"
        ]
    );
}

#[sqlx::test]
async fn summary_counts_what_is_not_deleted(pool: SqlitePool) {
    let anna = user(&pool, "anna@example.com").await;
    let mut deleted_deck = deck_row("d2", 10);
    deleted_deck.deleted_at = Some(10);
    let mut deleted_card = card_row("c2", "d1", 10);
    deleted_card.deleted_at = Some(10);
    push_ok(
        &pool,
        &anna,
        Changes {
            decks: vec![deck_row("d1", 10), deleted_deck],
            // c3 is not deleted itself but sits in a deleted deck.
            cards: vec![
                card_row("c1", "d1", 10),
                deleted_card,
                card_row("c3", "d2", 10),
            ],
            ..Changes::default()
        },
    )
    .await;
    let summary = backup::summary(&pool, &anna).await.unwrap();
    assert_eq!((summary.decks, summary.cards), (1, 1));
}

#[sqlx::test]
async fn export_restores_into_another_empty_account(pool: SqlitePool) {
    let anna = user(&pool, "anna@example.com").await;
    let bob = user(&pool, "bob@example.com").await;
    let mut account = small_account();
    let mut deleted = card_row("c2", "d1", 10);
    deleted.deleted_at = Some(10);
    account.cards.push(deleted);
    account.review_log[0].practice = true;
    push_ok(&pool, &anna, account).await;

    let exported = backup::export(&pool, &anna, NOW).await.unwrap();
    assert_eq!(exported.format, BACKUP_FORMAT);
    assert_eq!(exported.version, 1);
    assert_eq!(exported.cards.len(), 1, "deleted rows are not exported");
    assert_eq!(
        exported.settings,
        json!({ "new_per_day": 25, "ui_language": "en" })
    );

    // Through JSON, as the file travels.
    let file = serde_json::to_value(&exported).unwrap();
    let restored = backup::restore(&pool, &bob, backup::parse_backup(file).unwrap(), NOW + 1)
        .await
        .unwrap();
    assert_eq!(
        (
            restored.decks,
            restored.cards,
            restored.card_states,
            restored.review_log
        ),
        (1, 1, 1, 1)
    );

    let bobs = pull(&pool, &bob, 0, 500).await.unwrap().changes;
    let deck = &bobs.decks[0];
    assert_ne!(deck.id, "d1", "restored rows get new ids");
    assert_eq!(
        (
            deck.name.as_str(),
            deck.updated_at,
            deck.updated_by.as_str()
        ),
        ("Deck d1", NOW + 1, "server-import")
    );
    let card = &bobs.cards[0];
    assert_eq!(
        (card.deck_id.as_str(), card.front.as_str()),
        (deck.id.as_str(), "front c1")
    );
    assert_eq!(bobs.card_states[0].card_id, card.id);
    let log = &bobs.review_log[0];
    assert_eq!(
        (log.card_id.as_str(), log.rating, log.practice),
        (card.id.as_str(), 3, true)
    );
    assert_eq!(log.state_before, exported.review_log[0].state_before);
    assert_eq!(bobs.settings.unwrap().data, exported.settings);

    // Anna's data is untouched.
    assert_eq!(
        pull(&pool, &anna, 0, 500).await.unwrap().changes.decks[0].id,
        "d1"
    );
}

#[sqlx::test]
async fn restore_refuses_non_empty_accounts_and_foreign_files(pool: SqlitePool) {
    let anna = user(&pool, "anna@example.com").await;
    push_ok(&pool, &anna, small_account()).await;
    let file = serde_json::to_value(backup::export(&pool, &anna, NOW).await.unwrap()).unwrap();

    let error = backup::restore(
        &pool,
        &anna,
        backup::parse_backup(file.clone()).unwrap(),
        NOW,
    )
    .await
    .unwrap_err();
    assert!(matches!(
        error,
        crate::error::AppError::Conflict("account_not_empty")
    ));

    let mut newer = file.clone();
    newer["version"] = json!(2);
    newer["decks"] = json!("a different shape");
    assert!(matches!(
        backup::parse_backup(newer),
        Err(crate::error::AppError::BadRequest("unsupported_version"))
    ));

    let mut anki = file.clone();
    anki["format"] = json!("anki");
    assert!(matches!(
        backup::parse_backup(anki),
        Err(crate::error::AppError::BadRequest("invalid_format"))
    ));

    // A card pointing outside the file, or a row the push validation refuses, writes nothing.
    let bob = user(&pool, "bob@example.com").await;
    let mut orphan = file.clone();
    orphan["cards"][0]["deck_id"] = json!("elsewhere");
    let error = backup::restore(&pool, &bob, backup::parse_backup(orphan).unwrap(), NOW)
        .await
        .unwrap_err();
    assert!(matches!(
        error,
        crate::error::AppError::BadRequest("invalid_format")
    ));

    let mut invalid = file;
    invalid["cards"][0]["front"] = json!("");
    let error = backup::restore(&pool, &bob, backup::parse_backup(invalid).unwrap(), NOW)
        .await
        .unwrap_err();
    assert!(matches!(
        error,
        crate::error::AppError::BadRequest("invalid_format")
    ));
    assert_eq!(
        backup::summary(&pool, &bob).await.unwrap().decks,
        0,
        "the failed restore rolled back"
    );
}

#[sqlx::test]
async fn sync_routes_over_http(pool: SqlitePool) {
    create_user(&pool, "anna@example.com", false).await;
    create_user(&pool, "bob@example.com", false).await;
    let app = test_app(pool);
    let anna = login(&app, "anna@example.com", PASSWORD).await;
    let bob = login(&app, "bob@example.com", PASSWORD).await;

    for uri in ["/api/sync/pull", "/api/sync/summary", "/api/export"] {
        assert_eq!(
            send(&app, get(uri, None)).await.status,
            StatusCode::UNAUTHORIZED,
            "{uri}"
        );
    }

    let body = json!({ "device_id": "device-a", "changes": small_account() });
    assert_eq!(
        send(&app, post_json("/api/sync/push", &body, Some(&anna)))
            .await
            .status,
        StatusCode::OK
    );

    let page = send(&app, get("/api/sync/pull?cursor=0&limit=2", Some(&anna))).await;
    assert_eq!(page.status, StatusCode::OK);
    assert_eq!(page.body["changes"]["decks"][0]["id"], "d1");
    assert_eq!(page.body["changes"]["cards"][0]["id"], "c1");
    assert_eq!(page.body["changes"]["settings"], serde_json::Value::Null);
    assert_eq!(page.body["cursor"], 2);
    assert_eq!(page.body["has_more"], true);
    let defaults = send(&app, get("/api/sync/pull", Some(&anna))).await;
    assert_eq!(defaults.body["has_more"], false);

    let summary = send(&app, get("/api/sync/summary", Some(&anna))).await;
    assert_eq!(summary.body, json!({ "decks": 1, "cards": 1 }));

    let export = send(&app, get("/api/export", Some(&anna))).await;
    assert_eq!(export.status, StatusCode::OK);
    let disposition = export.headers[header::CONTENT_DISPOSITION]
        .to_str()
        .unwrap();
    assert!(
        disposition.starts_with("attachment; filename=\"annette-export-"),
        "{disposition}"
    );
    assert_eq!(export.body["format"], BACKUP_FORMAT);

    let restored = send(
        &app,
        post_json("/api/import/json", &export.body, Some(&bob)),
    )
    .await;
    assert_eq!(restored.status, StatusCode::OK, "{}", restored.body);
    assert_eq!(
        restored.body,
        json!({ "decks": 1, "cards": 1, "card_states": 1, "review_log": 1 })
    );
    let again = send(
        &app,
        post_json("/api/import/json", &export.body, Some(&bob)),
    )
    .await;
    assert_eq!(again.status, StatusCode::CONFLICT);
    assert_eq!(again.code(), "account_not_empty");
}
