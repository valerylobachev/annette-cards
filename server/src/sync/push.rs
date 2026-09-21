//! `POST /api/sync/push`: validate, check ownership, merge last-write-wins and stamp `server_seq`, all in one
//! transaction (architecture.md §6.1–§6.3).

use sqlx::{SqliteConnection, SqlitePool};

use crate::{
    error::AppError,
    sync::{
        dto::{
            CardDto, CardStateDto, Changes, DeckDto, EntityIds, PushResponse, Rejected,
            ReviewLogDto, SettingsDto, SyncEntity,
        },
        lww::incoming_wins,
        seq::next_seq,
        validate,
    },
};

/// The most rows (all entities together) one push may carry; the client sends batches of at most this size.
pub const MAX_PUSH_ROWS: usize = 500;

/// What happened to one pushed row.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Outcome {
    Applied,
    /// The stored row wins last-write-wins, or the push changes nothing.
    Skipped,
    Rejected(&'static str),
}

/// Applies a batch for `user_id` in one transaction, in dependency order (decks → cards → card states → review
/// log → settings), so a card can reference a deck from the same batch. A rejected row does not stop the others.
pub async fn push(
    pool: &SqlitePool,
    user_id: &str,
    changes: &Changes,
    now: i64,
) -> Result<PushResponse, AppError> {
    if changes.row_count() > MAX_PUSH_ROWS {
        return Err(AppError::BadRequest("validation_failed"));
    }

    // IMMEDIATE takes the write lock at the start, so a concurrent push cannot change a row between our ownership
    // and LWW checks and our write.
    let mut tx = pool.begin_with("BEGIN IMMEDIATE").await?;
    let mut result = PushResult::default();
    apply_changes(&mut tx, user_id, changes, &mut result).await?;
    tx.commit().await?;
    Ok(result.into_response(now))
}

/// The body of `push`, inside the caller's transaction (also used by restore).
pub async fn apply_changes(
    tx: &mut SqliteConnection,
    user_id: &str,
    changes: &Changes,
    result: &mut PushResult,
) -> Result<(), AppError> {
    for deck in &changes.decks {
        let outcome = push_deck(tx, user_id, deck).await?;
        result.record(SyncEntity::Decks, deck.id.clone(), outcome);
    }
    for card in &changes.cards {
        let outcome = push_card(tx, user_id, card).await?;
        result.record(SyncEntity::Cards, card.id.clone(), outcome);
    }
    for state in &changes.card_states {
        let outcome = push_card_state(tx, user_id, state).await?;
        result.record(SyncEntity::CardStates, state.key(), outcome);
    }
    for log in &changes.review_log {
        let outcome = push_review_log(tx, user_id, log).await?;
        result.record(SyncEntity::ReviewLog, log.id.clone(), outcome);
    }
    if let Some(settings) = &changes.settings {
        let outcome = push_settings(tx, user_id, settings).await?;
        result.record(SyncEntity::Settings, "settings".to_string(), outcome);
    }
    Ok(())
}

/// Outcomes collected per bucket while the batch is applied.
#[derive(Debug, Default)]
pub struct PushResult {
    pub applied: EntityIds,
    pub skipped: EntityIds,
    pub rejected: Vec<Rejected>,
}

impl PushResult {
    fn record(&mut self, entity: SyncEntity, id: String, outcome: Outcome) {
        let bucket = match outcome {
            Outcome::Applied => &mut self.applied,
            Outcome::Skipped => &mut self.skipped,
            Outcome::Rejected(code) => {
                self.rejected.push(Rejected {
                    entity,
                    id,
                    code: code.to_string(),
                });
                return;
            }
        };
        match entity {
            SyncEntity::Decks => bucket.decks.push(id),
            SyncEntity::Cards => bucket.cards.push(id),
            SyncEntity::CardStates => bucket.card_states.push(id),
            SyncEntity::ReviewLog => bucket.review_log.push(id),
            SyncEntity::Settings => bucket.settings = true,
        }
    }

    pub fn into_response(self, now: i64) -> PushResponse {
        PushResponse {
            applied: self.applied,
            skipped: self.skipped,
            rejected: self.rejected,
            server_time: now,
        }
    }
}

/// The owner and LWW stamp of a stored row.
struct Stored {
    user_id: String,
    updated_at: i64,
    updated_by: String,
}

/// Decides between insert/update (`Applied`), `Skipped` and `not_owned` for a mutable row.
fn merge_decision(
    stored: Option<&Stored>,
    user_id: &str,
    updated_at: i64,
    updated_by: &str,
) -> Outcome {
    match stored {
        None => Outcome::Applied,
        Some(row) if row.user_id != user_id => Outcome::Rejected("not_owned"),
        Some(row) if incoming_wins((updated_at, updated_by), (row.updated_at, &row.updated_by)) => {
            Outcome::Applied
        }
        Some(_) => Outcome::Skipped,
    }
}

async fn owns_deck(
    tx: &mut SqliteConnection,
    user_id: &str,
    deck_id: &str,
) -> Result<bool, AppError> {
    let owner = sqlx::query_scalar!("SELECT user_id FROM decks WHERE id = ?", deck_id)
        .fetch_optional(tx)
        .await?;
    Ok(owner.as_deref() == Some(user_id))
}

async fn owns_card(
    tx: &mut SqliteConnection,
    user_id: &str,
    card_id: &str,
) -> Result<bool, AppError> {
    let owner = sqlx::query_scalar!("SELECT user_id FROM cards WHERE id = ?", card_id)
        .fetch_optional(tx)
        .await?;
    Ok(owner.as_deref() == Some(user_id))
}

async fn push_deck(
    tx: &mut SqliteConnection,
    user_id: &str,
    deck: &DeckDto,
) -> Result<Outcome, AppError> {
    if let Err(code) = validate::deck(deck) {
        return Ok(Outcome::Rejected(code));
    }
    let stored = sqlx::query_as!(
        Stored,
        "SELECT user_id, updated_at, updated_by FROM decks WHERE id = ?",
        deck.id
    )
    .fetch_optional(&mut *tx)
    .await?;
    let outcome = merge_decision(stored.as_ref(), user_id, deck.updated_at, &deck.updated_by);
    if outcome != Outcome::Applied {
        return Ok(outcome);
    }

    let seq = next_seq(tx).await?;
    sqlx::query!(
        "INSERT INTO decks (id, user_id, name, target_lang, native_lang, directions, new_per_day, archived_at,
                            created_at, updated_at, updated_by, deleted_at, server_seq)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET
           name = excluded.name, target_lang = excluded.target_lang, native_lang = excluded.native_lang,
           directions = excluded.directions, new_per_day = excluded.new_per_day,
           archived_at = excluded.archived_at, created_at = excluded.created_at,
           updated_at = excluded.updated_at, updated_by = excluded.updated_by,
           deleted_at = excluded.deleted_at, server_seq = excluded.server_seq",
        deck.id,
        user_id,
        deck.name,
        deck.target_lang,
        deck.native_lang,
        deck.directions,
        deck.new_per_day,
        deck.archived_at,
        deck.created_at,
        deck.updated_at,
        deck.updated_by,
        deck.deleted_at,
        seq,
    )
    .execute(tx)
    .await?;
    Ok(Outcome::Applied)
}

async fn push_card(
    tx: &mut SqliteConnection,
    user_id: &str,
    card: &CardDto,
) -> Result<Outcome, AppError> {
    if let Err(code) = validate::card(card) {
        return Ok(Outcome::Rejected(code));
    }
    let stored = sqlx::query_as!(
        Stored,
        "SELECT user_id, updated_at, updated_by FROM cards WHERE id = ?",
        card.id
    )
    .fetch_optional(&mut *tx)
    .await?;
    if stored.as_ref().is_some_and(|row| row.user_id != user_id) {
        return Ok(Outcome::Rejected("not_owned"));
    }
    if !owns_deck(tx, user_id, &card.deck_id).await? {
        return Ok(Outcome::Rejected("deck_not_owned"));
    }
    let outcome = merge_decision(stored.as_ref(), user_id, card.updated_at, &card.updated_by);
    if outcome != Outcome::Applied {
        return Ok(outcome);
    }

    let tags = serde_json::to_string(&card.tags).map_err(anyhow::Error::from)?;
    let seq = next_seq(tx).await?;
    sqlx::query!(
        "INSERT INTO cards (id, user_id, deck_id, front, back, example, example_translation, ipa, tags, notes,
                            audio_id, created_at, updated_at, updated_by, deleted_at, server_seq)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET
           deck_id = excluded.deck_id, front = excluded.front, back = excluded.back, example = excluded.example,
           example_translation = excluded.example_translation, ipa = excluded.ipa, tags = excluded.tags,
           notes = excluded.notes, audio_id = excluded.audio_id, created_at = excluded.created_at,
           updated_at = excluded.updated_at, updated_by = excluded.updated_by,
           deleted_at = excluded.deleted_at, server_seq = excluded.server_seq",
        card.id,
        user_id,
        card.deck_id,
        card.front,
        card.back,
        card.example,
        card.example_translation,
        card.ipa,
        tags,
        card.notes,
        card.audio_id,
        card.created_at,
        card.updated_at,
        card.updated_by,
        card.deleted_at,
        seq,
    )
    .execute(tx)
    .await?;
    Ok(Outcome::Applied)
}

async fn push_card_state(
    tx: &mut SqliteConnection,
    user_id: &str,
    state: &CardStateDto,
) -> Result<Outcome, AppError> {
    if let Err(code) = validate::card_state(state) {
        return Ok(Outcome::Rejected(code));
    }
    let stored = sqlx::query_as!(
        Stored,
        "SELECT user_id, updated_at, updated_by FROM card_states WHERE card_id = ? AND direction = ?",
        state.card_id,
        state.direction,
    )
    .fetch_optional(&mut *tx)
    .await?;
    if stored.as_ref().is_some_and(|row| row.user_id != user_id) {
        return Ok(Outcome::Rejected("not_owned"));
    }
    if !owns_card(tx, user_id, &state.card_id).await? {
        return Ok(Outcome::Rejected("card_not_owned"));
    }
    let outcome = merge_decision(
        stored.as_ref(),
        user_id,
        state.updated_at,
        &state.updated_by,
    );
    if outcome != Outcome::Applied {
        return Ok(outcome);
    }

    let seq = next_seq(tx).await?;
    sqlx::query!(
        "INSERT INTO card_states (card_id, direction, user_id, state, due, stability, difficulty, elapsed_days,
                                  scheduled_days, learning_steps, reps, lapses, last_review, updated_at,
                                  updated_by, deleted_at, server_seq)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (card_id, direction) DO UPDATE SET
           state = excluded.state, due = excluded.due, stability = excluded.stability,
           difficulty = excluded.difficulty, elapsed_days = excluded.elapsed_days,
           scheduled_days = excluded.scheduled_days, learning_steps = excluded.learning_steps,
           reps = excluded.reps, lapses = excluded.lapses, last_review = excluded.last_review,
           updated_at = excluded.updated_at, updated_by = excluded.updated_by,
           deleted_at = excluded.deleted_at, server_seq = excluded.server_seq",
        state.card_id,
        state.direction,
        user_id,
        state.state,
        state.due,
        state.stability,
        state.difficulty,
        state.elapsed_days,
        state.scheduled_days,
        state.learning_steps,
        state.reps,
        state.lapses,
        state.last_review,
        state.updated_at,
        state.updated_by,
        state.deleted_at,
        seq,
    )
    .execute(tx)
    .await?;
    Ok(Outcome::Applied)
}

/// Review log entries are append-only: a new id is inserted; for a known id only a first `deleted_at` (undo of the
/// answer) is taken over, every other field stays as first pushed.
async fn push_review_log(
    tx: &mut SqliteConnection,
    user_id: &str,
    log: &ReviewLogDto,
) -> Result<Outcome, AppError> {
    if let Err(code) = validate::review_log(log) {
        return Ok(Outcome::Rejected(code));
    }
    let stored = sqlx::query!(
        "SELECT user_id, deleted_at FROM review_log WHERE id = ?",
        log.id
    )
    .fetch_optional(&mut *tx)
    .await?;
    if stored.as_ref().is_some_and(|row| row.user_id != user_id) {
        return Ok(Outcome::Rejected("not_owned"));
    }
    if !owns_card(tx, user_id, &log.card_id).await? {
        return Ok(Outcome::Rejected("card_not_owned"));
    }

    if let Some(row) = stored {
        let undo = row.deleted_at.is_none() && log.deleted_at.is_some();
        if !undo {
            return Ok(Outcome::Skipped);
        }
        let seq = next_seq(tx).await?;
        sqlx::query!(
            "UPDATE review_log SET deleted_at = ?, updated_at = ?, updated_by = ?, server_seq = ?
             WHERE id = ? AND user_id = ?",
            log.deleted_at,
            log.updated_at,
            log.updated_by,
            seq,
            log.id,
            user_id,
        )
        .execute(tx)
        .await?;
        return Ok(Outcome::Applied);
    }

    let state_before = log.state_before.to_string();
    let seq = next_seq(tx).await?;
    sqlx::query!(
        "INSERT INTO review_log (id, user_id, card_id, direction, rating, mode, state_before, reviewed_at,
                                 duration_ms, practice, updated_at, updated_by, deleted_at, server_seq)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        log.id,
        user_id,
        log.card_id,
        log.direction,
        log.rating,
        log.mode,
        state_before,
        log.reviewed_at,
        log.duration_ms,
        log.practice,
        log.updated_at,
        log.updated_by,
        log.deleted_at,
        seq,
    )
    .execute(tx)
    .await?;
    Ok(Outcome::Applied)
}

async fn push_settings(
    tx: &mut SqliteConnection,
    user_id: &str,
    settings: &SettingsDto,
) -> Result<Outcome, AppError> {
    if let Err(code) = validate::settings(settings) {
        return Ok(Outcome::Rejected(code));
    }
    let stored = sqlx::query_as!(
        Stored,
        r#"SELECT user_id AS "user_id!", updated_at, updated_by FROM user_settings WHERE user_id = ?"#,
        user_id,
    )
    .fetch_optional(&mut *tx)
    .await?;
    let outcome = merge_decision(
        stored.as_ref(),
        user_id,
        settings.updated_at,
        &settings.updated_by,
    );
    if outcome != Outcome::Applied {
        return Ok(outcome);
    }

    let data = settings.data.to_string();
    let seq = next_seq(tx).await?;
    sqlx::query!(
        "INSERT INTO user_settings (user_id, data, updated_at, updated_by, server_seq) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (user_id) DO UPDATE SET
           data = excluded.data, updated_at = excluded.updated_at, updated_by = excluded.updated_by,
           server_seq = excluded.server_seq",
        user_id,
        data,
        settings.updated_at,
        settings.updated_by,
        seq,
    )
    .execute(tx)
    .await?;
    Ok(Outcome::Applied)
}
