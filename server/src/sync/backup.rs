//! Account summary, full export and restore into an empty account (architecture.md §6.5, decisions D6, D9).

use std::collections::{HashMap, HashSet};

use sqlx::SqlitePool;
use uuid::Uuid;

use crate::{
    error::AppError,
    sync::{
        dto::{Backup, Changes, RestoreResponse, SettingsDto, SummaryResponse},
        pull,
        push::{self, PushResult},
    },
};

pub const BACKUP_FORMAT: &str = "annette-cards-backup";
pub const BACKUP_VERSION: i64 = 1;
/// `updated_by` of restored rows.
pub const RESTORE_DEVICE: &str = "server-import";

/// Counts of the user's decks and cards that are not deleted (cards of deleted decks do not count).
pub async fn summary(pool: &SqlitePool, user_id: &str) -> Result<SummaryResponse, AppError> {
    let decks = sqlx::query_scalar!(
        "SELECT COUNT(*) FROM decks WHERE user_id = ? AND deleted_at IS NULL",
        user_id
    )
    .fetch_one(pool)
    .await?;
    let cards = sqlx::query_scalar!(
        "SELECT COUNT(*) FROM cards c JOIN decks d ON d.id = c.deck_id
         WHERE c.user_id = ? AND d.user_id = c.user_id AND c.deleted_at IS NULL AND d.deleted_at IS NULL",
        user_id
    )
    .fetch_one(pool)
    .await?;
    Ok(SummaryResponse { decks, cards })
}

/// The user's data as a backup: rows that are not deleted, cards only in exported decks, states and logs only of
/// exported cards.
pub async fn export(pool: &SqlitePool, user_id: &str, now: i64) -> Result<Backup, AppError> {
    let rows = pull::all_rows(pool, user_id).await?;

    let decks: Vec<_> = rows
        .decks
        .into_iter()
        .filter(|deck| deck.deleted_at.is_none())
        .collect();
    let deck_ids: HashSet<&str> = decks.iter().map(|deck| deck.id.as_str()).collect();
    let cards: Vec<_> = rows
        .cards
        .into_iter()
        .filter(|card| card.deleted_at.is_none() && deck_ids.contains(card.deck_id.as_str()))
        .collect();
    let card_ids: HashSet<&str> = cards.iter().map(|card| card.id.as_str()).collect();
    let card_states = rows
        .card_states
        .into_iter()
        .filter(|state| state.deleted_at.is_none() && card_ids.contains(state.card_id.as_str()))
        .collect();
    let review_log = rows
        .review_log
        .into_iter()
        .filter(|log| log.deleted_at.is_none() && card_ids.contains(log.card_id.as_str()))
        .collect();
    let settings = rows
        .settings
        .map_or_else(|| serde_json::json!({}), |settings| settings.data);

    Ok(Backup {
        format: BACKUP_FORMAT.to_string(),
        version: BACKUP_VERSION,
        exported_at: now,
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        decks,
        cards,
        card_states,
        review_log,
        settings,
    })
}

/// Checks the format marker and version before reading the rows, so a newer backup is reported as
/// `unsupported_version` even if its rows have a different shape.
pub fn parse_backup(json: serde_json::Value) -> Result<Backup, AppError> {
    if json["format"] != BACKUP_FORMAT {
        return Err(AppError::BadRequest("invalid_format"));
    }
    match json["version"].as_i64() {
        Some(version) if version > BACKUP_VERSION => {
            return Err(AppError::BadRequest("unsupported_version"));
        }
        Some(BACKUP_VERSION) => {}
        _ => return Err(AppError::BadRequest("invalid_format")),
    }
    serde_json::from_value(json).map_err(|_| AppError::BadRequest("invalid_format"))
}

/// Writes a backup into an account without decks (409 `account_not_empty` otherwise). All rows get new ids, so a
/// backup of another account (or of rows still stored soft-deleted) never collides, and are stamped as new edits
/// (`updated_at = now`, `updated_by = "server-import"`) so every device pulls them. They pass the same validation
/// and ownership checks as a push; if any row is refused, nothing is written (400 `invalid_format`).
pub async fn restore(
    pool: &SqlitePool,
    user_id: &str,
    backup: Backup,
    now: i64,
) -> Result<RestoreResponse, AppError> {
    let changes = restore_changes(backup, now)?;

    let mut tx = pool.begin_with("BEGIN IMMEDIATE").await?;
    let active_deck = sqlx::query_scalar!(
        "SELECT id FROM decks WHERE user_id = ? AND deleted_at IS NULL LIMIT 1",
        user_id
    )
    .fetch_optional(&mut *tx)
    .await?;
    if active_deck.is_some() {
        return Err(AppError::Conflict("account_not_empty"));
    }

    let mut result = PushResult::default();
    push::apply_changes(&mut tx, user_id, &changes, &mut result).await?;
    if !result.rejected.is_empty() {
        tracing::warn!(
            rejected = result.rejected.len(),
            "restore refused: backup rows rejected"
        );
        return Err(AppError::BadRequest("invalid_format"));
    }
    tx.commit().await?;

    Ok(RestoreResponse {
        decks: result.applied.decks.len(),
        cards: result.applied.cards.len(),
        card_states: result.applied.card_states.len(),
        review_log: result.applied.review_log.len(),
    })
}

/// The backup as push changes: new UUIDv7 ids with references following them, fresh stamps. A reference to a deck or
/// card outside the backup is `invalid_format`.
fn restore_changes(backup: Backup, now: i64) -> Result<Changes, AppError> {
    let new_ids = |ids: Vec<&String>| -> HashMap<String, String> {
        ids.into_iter()
            .map(|id| (id.clone(), Uuid::now_v7().to_string()))
            .collect()
    };
    let deck_ids = new_ids(backup.decks.iter().map(|deck| &deck.id).collect());
    let card_ids = new_ids(backup.cards.iter().map(|card| &card.id).collect());
    let lookup = |ids: &HashMap<String, String>, id: &str| {
        ids.get(id)
            .cloned()
            .ok_or(AppError::BadRequest("invalid_format"))
    };

    let mut changes = Changes::default();
    for mut deck in backup.decks {
        deck.id = lookup(&deck_ids, &deck.id)?;
        (deck.updated_at, deck.updated_by) = (now, RESTORE_DEVICE.to_string());
        changes.decks.push(deck);
    }
    for mut card in backup.cards {
        card.id = lookup(&card_ids, &card.id)?;
        card.deck_id = lookup(&deck_ids, &card.deck_id)?;
        (card.updated_at, card.updated_by) = (now, RESTORE_DEVICE.to_string());
        changes.cards.push(card);
    }
    for mut state in backup.card_states {
        state.card_id = lookup(&card_ids, &state.card_id)?;
        (state.updated_at, state.updated_by) = (now, RESTORE_DEVICE.to_string());
        changes.card_states.push(state);
    }
    for mut log in backup.review_log {
        log.id = Uuid::now_v7().to_string();
        log.card_id = lookup(&card_ids, &log.card_id)?;
        (log.updated_at, log.updated_by) = (now, RESTORE_DEVICE.to_string());
        changes.review_log.push(log);
    }
    let has_settings = backup
        .settings
        .as_object()
        .is_some_and(|fields| !fields.is_empty());
    if has_settings {
        changes.settings = Some(SettingsDto {
            data: backup.settings,
            updated_at: now,
            updated_by: RESTORE_DEVICE.to_string(),
        });
    }
    Ok(changes)
}
