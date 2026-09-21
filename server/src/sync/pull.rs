//! `GET /api/sync/pull`: the user's rows changed after a cursor, across all entities in `server_seq` order.

use sqlx::SqlitePool;

use crate::{
    error::AppError,
    sync::dto::{
        CardDto, CardStateDto, Changes, DeckDto, Direction, Directions, PullResponse, ReviewLogDto,
        ReviewMode, SettingsDto,
    },
};

pub const DEFAULT_PULL_LIMIT: i64 = 500;
pub const MAX_PULL_LIMIT: i64 = 1000;

/// One pulled row with its `server_seq`, before the page is cut.
enum Row {
    Deck(DeckDto),
    Card(CardDto),
    CardState(CardStateDto),
    ReviewLog(ReviewLogDto),
    Settings(SettingsDto),
}

/// Up to `limit` (clamped to 1–1000) rows with `server_seq > cursor`, soft-deleted rows included. `cursor` in the
/// response is the largest `server_seq` returned (the input cursor when nothing is returned); `has_more` says
/// whether another page follows.
///
/// Each table is read in `server_seq` order with `LIMIT limit + 1`; the global first `limit` rows are always among
/// those, so merging the five lists by `server_seq` and cutting gives the page, and one row beyond it means more.
pub async fn pull(
    pool: &SqlitePool,
    user_id: &str,
    cursor: i64,
    limit: i64,
) -> Result<PullResponse, AppError> {
    let limit = limit.clamp(1, MAX_PULL_LIMIT);
    let fetch = limit + 1;

    let mut rows: Vec<(i64, Row)> = Vec::new();
    rows.extend(decks_after(pool, user_id, cursor, fetch).await?);
    rows.extend(cards_after(pool, user_id, cursor, fetch).await?);
    rows.extend(card_states_after(pool, user_id, cursor, fetch).await?);
    rows.extend(review_log_after(pool, user_id, cursor, fetch).await?);
    rows.extend(settings_after(pool, user_id, cursor).await?);
    rows.sort_by_key(|(seq, _)| *seq);

    let page_size = usize::try_from(limit).unwrap_or(usize::MAX);
    let has_more = rows.len() > page_size;
    rows.truncate(page_size);

    let next_cursor = rows.last().map_or(cursor, |(seq, _)| *seq);
    Ok(PullResponse {
        changes: into_changes(rows),
        cursor: next_cursor,
        has_more,
    })
}

/// Sorts rows into their entity lists, keeping their order.
fn into_changes(rows: Vec<(i64, Row)>) -> Changes {
    let mut changes = Changes::default();
    for (_, row) in rows {
        match row {
            Row::Deck(deck) => changes.decks.push(deck),
            Row::Card(card) => changes.cards.push(card),
            Row::CardState(state) => changes.card_states.push(state),
            Row::ReviewLog(log) => changes.review_log.push(log),
            Row::Settings(settings) => changes.settings = Some(settings),
        }
    }
    changes
}

/// Every row of the user, soft-deleted ones included (export).
pub async fn all_rows(pool: &SqlitePool, user_id: &str) -> Result<Changes, AppError> {
    let mut rows: Vec<(i64, Row)> = Vec::new();
    rows.extend(decks_after(pool, user_id, 0, i64::MAX).await?);
    rows.extend(cards_after(pool, user_id, 0, i64::MAX).await?);
    rows.extend(card_states_after(pool, user_id, 0, i64::MAX).await?);
    rows.extend(review_log_after(pool, user_id, 0, i64::MAX).await?);
    rows.extend(settings_after(pool, user_id, 0).await?);
    rows.sort_by_key(|(seq, _)| *seq);
    Ok(into_changes(rows))
}

async fn decks_after(
    pool: &SqlitePool,
    user_id: &str,
    cursor: i64,
    limit: i64,
) -> Result<Vec<(i64, Row)>, AppError> {
    let rows = sqlx::query!(
        r#"SELECT id AS "id!", name, target_lang, native_lang, directions AS "directions: Directions", new_per_day,
                  archived_at, created_at, updated_at, updated_by, deleted_at, server_seq
           FROM decks WHERE user_id = ? AND server_seq > ? ORDER BY server_seq LIMIT ?"#,
        user_id,
        cursor,
        limit,
    )
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|row| {
            let deck = DeckDto {
                id: row.id,
                name: row.name,
                target_lang: row.target_lang,
                native_lang: row.native_lang,
                directions: row.directions,
                new_per_day: row.new_per_day,
                archived_at: row.archived_at,
                created_at: row.created_at,
                updated_at: row.updated_at,
                updated_by: row.updated_by,
                deleted_at: row.deleted_at,
            };
            (row.server_seq, Row::Deck(deck))
        })
        .collect())
}

async fn cards_after(
    pool: &SqlitePool,
    user_id: &str,
    cursor: i64,
    limit: i64,
) -> Result<Vec<(i64, Row)>, AppError> {
    let rows = sqlx::query!(
        r#"SELECT id AS "id!", deck_id, front, back, example, example_translation, ipa, tags, notes, audio_id,
                  created_at, updated_at, updated_by, deleted_at, server_seq
           FROM cards WHERE user_id = ? AND server_seq > ? ORDER BY server_seq LIMIT ?"#,
        user_id,
        cursor,
        limit,
    )
    .fetch_all(pool)
    .await?;
    let mut result = Vec::with_capacity(rows.len());
    for row in rows {
        let card = CardDto {
            id: row.id,
            deck_id: row.deck_id,
            front: row.front,
            back: row.back,
            example: row.example,
            example_translation: row.example_translation,
            ipa: row.ipa,
            tags: parse_json(&row.tags)?,
            notes: row.notes,
            audio_id: row.audio_id,
            created_at: row.created_at,
            updated_at: row.updated_at,
            updated_by: row.updated_by,
            deleted_at: row.deleted_at,
        };
        result.push((row.server_seq, Row::Card(card)));
    }
    Ok(result)
}

async fn card_states_after(
    pool: &SqlitePool,
    user_id: &str,
    cursor: i64,
    limit: i64,
) -> Result<Vec<(i64, Row)>, AppError> {
    let rows = sqlx::query!(
        r#"SELECT card_id, direction AS "direction: Direction", state, due, stability, difficulty, elapsed_days,
                  scheduled_days, learning_steps, reps, lapses, last_review, updated_at, updated_by, deleted_at,
                  server_seq
           FROM card_states WHERE user_id = ? AND server_seq > ? ORDER BY server_seq LIMIT ?"#,
        user_id,
        cursor,
        limit,
    )
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|row| {
            let state = CardStateDto {
                card_id: row.card_id,
                direction: row.direction,
                state: row.state,
                due: row.due,
                stability: row.stability,
                difficulty: row.difficulty,
                elapsed_days: row.elapsed_days,
                scheduled_days: row.scheduled_days,
                learning_steps: row.learning_steps,
                reps: row.reps,
                lapses: row.lapses,
                last_review: row.last_review,
                updated_at: row.updated_at,
                updated_by: row.updated_by,
                deleted_at: row.deleted_at,
            };
            (row.server_seq, Row::CardState(state))
        })
        .collect())
}

async fn review_log_after(
    pool: &SqlitePool,
    user_id: &str,
    cursor: i64,
    limit: i64,
) -> Result<Vec<(i64, Row)>, AppError> {
    let rows = sqlx::query!(
        r#"SELECT id AS "id!", card_id, direction AS "direction: Direction", rating, mode AS "mode: ReviewMode",
                  state_before, reviewed_at, duration_ms, practice AS "practice: bool", updated_at, updated_by,
                  deleted_at, server_seq
           FROM review_log WHERE user_id = ? AND server_seq > ? ORDER BY server_seq LIMIT ?"#,
        user_id,
        cursor,
        limit,
    )
    .fetch_all(pool)
    .await?;
    let mut result = Vec::with_capacity(rows.len());
    for row in rows {
        let log = ReviewLogDto {
            id: row.id,
            card_id: row.card_id,
            direction: row.direction,
            rating: row.rating,
            mode: row.mode,
            state_before: parse_json(&row.state_before)?,
            reviewed_at: row.reviewed_at,
            duration_ms: row.duration_ms,
            practice: row.practice,
            updated_at: row.updated_at,
            updated_by: row.updated_by,
            deleted_at: row.deleted_at,
        };
        result.push((row.server_seq, Row::ReviewLog(log)));
    }
    Ok(result)
}

async fn settings_after(
    pool: &SqlitePool,
    user_id: &str,
    cursor: i64,
) -> Result<Option<(i64, Row)>, AppError> {
    let row = sqlx::query!(
        "SELECT data, updated_at, updated_by, server_seq FROM user_settings WHERE user_id = ? AND server_seq > ?",
        user_id,
        cursor,
    )
    .fetch_optional(pool)
    .await?;
    match row {
        Some(row) => {
            let settings = SettingsDto {
                data: parse_json(&row.data)?,
                updated_at: row.updated_at,
                updated_by: row.updated_by,
            };
            Ok(Some((row.server_seq, Row::Settings(settings))))
        }
        None => Ok(None),
    }
}

/// JSON columns (`tags`, `state_before`, settings `data`) were written by the server from valid JSON.
fn parse_json<T: serde::de::DeserializeOwned>(text: &str) -> Result<T, AppError> {
    Ok(serde_json::from_str(text).map_err(anyhow::Error::from)?)
}
