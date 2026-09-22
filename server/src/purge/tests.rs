//! The maintenance purge on hand-made rows of two users.

use sqlx::SqlitePool;

use super::{PurgeReport, RETENTION_DAYS, purge, run_scheduled};
use crate::{
    auth::users::User,
    clock::{DAY_MS, HOUR_MS},
    test_support::create_user,
};

const NOW: i64 = 1_790_000_000_000;

fn days_ago(days: i64) -> Option<i64> {
    Some(NOW - days * DAY_MS)
}

async fn add_deck(pool: &SqlitePool, user: &User, id: &str, deleted_at: Option<i64>) {
    sqlx::query("INSERT INTO decks (id, user_id, name, target_lang, native_lang, directions, created_at, updated_at, updated_by, deleted_at, server_seq) VALUES (?, ?, 'English', 'en-GB', 'ru', 'both', 1, 1, 'd', ?, 1)")
        .bind(id)
        .bind(&user.id)
        .bind(deleted_at)
        .execute(pool)
        .await
        .unwrap();
}

/// A card with a forward state; `deleted_at` applies to both, like a delete on the device.
async fn add_card(pool: &SqlitePool, user: &User, id: &str, deck: &str, deleted_at: Option<i64>) {
    sqlx::query("INSERT INTO cards (id, user_id, deck_id, front, back, created_at, updated_at, updated_by, deleted_at, server_seq) VALUES (?, ?, ?, 'word', 'слово', 1, 1, 'd', ?, 1)")
        .bind(id)
        .bind(&user.id)
        .bind(deck)
        .bind(deleted_at)
        .execute(pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO card_states (card_id, direction, user_id, state, due, stability, difficulty, elapsed_days, scheduled_days, learning_steps, reps, lapses, updated_at, updated_by, deleted_at, server_seq) VALUES (?, 'forward', ?, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 'd', ?, 1)")
        .bind(id)
        .bind(&user.id)
        .bind(deleted_at)
        .execute(pool)
        .await
        .unwrap();
}

async fn add_log(pool: &SqlitePool, user: &User, id: &str, card: &str, deleted_at: Option<i64>) {
    sqlx::query("INSERT INTO review_log (id, user_id, card_id, direction, rating, mode, state_before, reviewed_at, duration_ms, updated_at, updated_by, deleted_at, server_seq) VALUES (?, ?, ?, 'forward', 3, 'swipe', '{}', 1, 1000, 1, 'd', ?, 1)")
        .bind(id)
        .bind(&user.id)
        .bind(card)
        .bind(deleted_at)
        .execute(pool)
        .await
        .unwrap();
}

/// A clip of `card`; `attach` also points the card to it.
async fn add_audio(
    pool: &SqlitePool,
    user: &User,
    id: &str,
    card: &str,
    created_at: i64,
    attach: bool,
) {
    sqlx::query("INSERT INTO audio_assets (id, user_id, card_id, source, mime, bytes, created_at) VALUES (?, ?, ?, 'azure', 'audio/mpeg', x'00', ?)")
        .bind(id)
        .bind(&user.id)
        .bind(card)
        .bind(created_at)
        .execute(pool)
        .await
        .unwrap();
    if attach {
        sqlx::query("UPDATE cards SET audio_id = ? WHERE id = ?")
            .bind(id)
            .bind(card)
            .execute(pool)
            .await
            .unwrap();
    }
}

/// Whether the row with this id (for `card_states`: this card) still exists.
async fn exists(pool: &SqlitePool, table: &str, id: &str) -> bool {
    let sql = match table {
        "decks" => "SELECT count(*) FROM decks WHERE id = ?",
        "cards" => "SELECT count(*) FROM cards WHERE id = ?",
        "card_states" => "SELECT count(*) FROM card_states WHERE card_id = ?",
        "review_log" => "SELECT count(*) FROM review_log WHERE id = ?",
        "audio_assets" => "SELECT count(*) FROM audio_assets WHERE id = ?",
        _ => panic!("unknown table {table}"),
    };
    sqlx::query_scalar::<_, i64>(sql)
        .bind(id)
        .fetch_one(pool)
        .await
        .unwrap()
        > 0
}

async fn row_counts(pool: &SqlitePool) -> Vec<i64> {
    let mut counts = Vec::new();
    for sql in [
        "SELECT count(*) FROM decks",
        "SELECT count(*) FROM cards",
        "SELECT count(*) FROM card_states",
        "SELECT count(*) FROM review_log",
        "SELECT count(*) FROM audio_assets",
    ] {
        counts.push(sqlx::query_scalar(sql).fetch_one(pool).await.unwrap());
    }
    counts
}

#[sqlx::test]
async fn a_deck_deleted_91_days_ago_goes_with_its_cards_states_logs_and_audio(pool: SqlitePool) {
    let anna = create_user(&pool, "anna@example.com", false).await;
    add_deck(&pool, &anna, "old", days_ago(91)).await;
    add_card(&pool, &anna, "old-card", "old", days_ago(91)).await;
    add_log(&pool, &anna, "old-log", "old-card", None).await;
    add_audio(
        &pool,
        &anna,
        "old-audio",
        "old-card",
        NOW - 200 * DAY_MS,
        true,
    )
    .await;

    let report = purge(&pool, NOW, RETENTION_DAYS, false).await.unwrap();

    assert_eq!(
        report,
        PurgeReport {
            review_log: 1,
            card_states: 1,
            audio_assets: 1,
            cards: 1,
            decks: 1,
        }
    );
    assert_eq!(row_counts(&pool).await, [0, 0, 0, 0, 0]);
}

#[sqlx::test]
async fn cards_of_an_old_deleted_deck_go_even_when_not_marked_deleted(pool: SqlitePool) {
    let anna = create_user(&pool, "anna@example.com", false).await;
    add_deck(&pool, &anna, "old", days_ago(120)).await;
    add_card(&pool, &anna, "unmarked", "old", None).await;
    add_log(&pool, &anna, "log", "unmarked", None).await;

    purge(&pool, NOW, RETENTION_DAYS, false).await.unwrap();

    assert_eq!(row_counts(&pool).await, [0, 0, 0, 0, 0]);
}

#[sqlx::test]
async fn a_deck_deleted_89_days_ago_and_everything_active_are_kept(pool: SqlitePool) {
    let anna = create_user(&pool, "anna@example.com", false).await;
    add_deck(&pool, &anna, "recent", days_ago(89)).await;
    add_card(&pool, &anna, "recent-card", "recent", days_ago(89)).await;
    add_log(&pool, &anna, "recent-log", "recent-card", None).await;
    add_audio(
        &pool,
        &anna,
        "recent-audio",
        "recent-card",
        NOW - 200 * DAY_MS,
        true,
    )
    .await;
    add_deck(&pool, &anna, "live", None).await;
    add_card(&pool, &anna, "live-card", "live", None).await;
    add_log(&pool, &anna, "live-log", "live-card", None).await;
    add_audio(
        &pool,
        &anna,
        "live-audio",
        "live-card",
        NOW - 200 * DAY_MS,
        true,
    )
    .await;

    let report = purge(&pool, NOW, RETENTION_DAYS, false).await.unwrap();

    assert_eq!(report, PurgeReport::default());
    assert_eq!(row_counts(&pool).await, [2, 2, 2, 2, 2]);
}

#[sqlx::test]
async fn undone_answers_go_only_after_the_retention_period(pool: SqlitePool) {
    let anna = create_user(&pool, "anna@example.com", false).await;
    add_deck(&pool, &anna, "live", None).await;
    add_card(&pool, &anna, "card", "live", None).await;
    add_log(&pool, &anna, "undone-10-days-ago", "card", days_ago(10)).await;
    add_log(&pool, &anna, "undone-100-days-ago", "card", days_ago(100)).await;

    let report = purge(&pool, NOW, RETENTION_DAYS, false).await.unwrap();

    assert_eq!(report.review_log, 1);
    assert!(exists(&pool, "review_log", "undone-10-days-ago").await);
    assert!(!exists(&pool, "review_log", "undone-100-days-ago").await);
    assert!(exists(&pool, "cards", "card").await);
    assert!(exists(&pool, "card_states", "card").await);
}

#[sqlx::test]
async fn clips_no_card_points_to_go_after_a_day(pool: SqlitePool) {
    let anna = create_user(&pool, "anna@example.com", false).await;
    add_deck(&pool, &anna, "live", None).await;
    add_card(&pool, &anna, "card", "live", None).await;
    add_audio(&pool, &anna, "replaced", "card", NOW - 3 * DAY_MS, false).await;
    add_audio(&pool, &anna, "current", "card", NOW - 2 * DAY_MS, true).await;
    add_audio(&pool, &anna, "just-generated", "card", NOW - HOUR_MS, false).await;

    let report = purge(&pool, NOW, RETENTION_DAYS, false).await.unwrap();

    assert_eq!(report.audio_assets, 1);
    assert!(!exists(&pool, "audio_assets", "replaced").await);
    assert!(exists(&pool, "audio_assets", "current").await);
    assert!(exists(&pool, "audio_assets", "just-generated").await);
}

#[sqlx::test]
async fn purge_never_deletes_live_rows_of_any_user(pool: SqlitePool) {
    let anna = create_user(&pool, "anna@example.com", false).await;
    let boris = create_user(&pool, "boris@example.com", false).await;
    for (user, prefix) in [(&anna, "anna"), (&boris, "boris")] {
        let live = format!("{prefix}-live");
        let old = format!("{prefix}-old");
        add_deck(&pool, user, &live, None).await;
        add_card(&pool, user, &format!("{live}-card"), &live, None).await;
        add_log(
            &pool,
            user,
            &format!("{live}-log"),
            &format!("{live}-card"),
            None,
        )
        .await;
        add_audio(
            &pool,
            user,
            &format!("{live}-audio"),
            &format!("{live}-card"),
            1,
            true,
        )
        .await;
        add_card(&pool, user, &format!("{old}-card"), &live, days_ago(95)).await;
        add_log(
            &pool,
            user,
            &format!("{old}-log"),
            &format!("{old}-card"),
            None,
        )
        .await;
    }

    let report = purge(&pool, NOW, RETENTION_DAYS, false).await.unwrap();

    assert_eq!(
        (report.cards, report.card_states, report.review_log),
        (2, 2, 2)
    );
    for prefix in ["anna", "boris"] {
        let live = format!("{prefix}-live");
        assert!(exists(&pool, "decks", &live).await);
        assert!(exists(&pool, "cards", &format!("{live}-card")).await);
        assert!(exists(&pool, "card_states", &format!("{live}-card")).await);
        assert!(exists(&pool, "review_log", &format!("{live}-log")).await);
        assert!(exists(&pool, "audio_assets", &format!("{live}-audio")).await);
        assert!(!exists(&pool, "cards", &format!("{prefix}-old-card")).await);
    }
}

#[sqlx::test]
async fn a_dry_run_reports_the_counts_and_deletes_nothing(pool: SqlitePool) {
    let anna = create_user(&pool, "anna@example.com", false).await;
    add_deck(&pool, &anna, "old", days_ago(91)).await;
    add_card(&pool, &anna, "old-card", "old", days_ago(91)).await;
    add_log(&pool, &anna, "old-log", "old-card", None).await;
    let before = row_counts(&pool).await;

    let dry = purge(&pool, NOW, RETENTION_DAYS, true).await.unwrap();

    assert_eq!((dry.decks, dry.cards, dry.review_log), (1, 1, 1));
    assert_eq!(row_counts(&pool).await, before);
    assert_eq!(purge(&pool, NOW, RETENTION_DAYS, false).await.unwrap(), dry);
}

#[sqlx::test]
async fn a_shorter_retention_purges_more_recent_deletions(pool: SqlitePool) {
    let anna = create_user(&pool, "anna@example.com", false).await;
    add_deck(&pool, &anna, "deck", days_ago(40)).await;

    assert_eq!(purge(&pool, NOW, 60, false).await.unwrap().decks, 0);
    assert_eq!(purge(&pool, NOW, 30, false).await.unwrap().decks, 1);
}

#[sqlx::test]
async fn the_scheduled_run_purges_with_the_default_retention(pool: SqlitePool) {
    let anna = create_user(&pool, "anna@example.com", false).await;
    add_deck(&pool, &anna, "old", days_ago(91)).await;
    add_deck(&pool, &anna, "recent", days_ago(89)).await;

    run_scheduled(&pool, NOW).await;

    assert!(!exists(&pool, "decks", "old").await);
    assert!(exists(&pool, "decks", "recent").await);
}
