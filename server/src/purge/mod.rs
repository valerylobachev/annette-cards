//! Maintenance purge (architecture.md §11): physically deletes rows soft-deleted longer ago than the retention
//! period and pronunciation clips no card points to. This is the only place that deletes synced rows. It runs daily
//! inside `serve` and on demand as `annette-cards purge`.

use std::{fmt, time::Duration};

use sqlx::SqlitePool;
use tokio::time::{Instant, interval_at};

use crate::{
    clock::{DAY_MS, now_ms},
    error::AppError,
};

/// Soft-deleted rows are kept this long, so devices that were offline for a while still pull the deletion.
pub const RETENTION_DAYS: u32 = 90;
/// A clip no card points to is kept for a day, so a clip being attached right now is never raced.
const ORPHAN_AUDIO_MIN_AGE_MS: i64 = DAY_MS;
/// The first daily run waits a little after startup, so a restart loop does not purge over and over.
const FIRST_RUN_DELAY: Duration = Duration::from_secs(5 * 60);
const RUN_INTERVAL: Duration = Duration::from_secs(24 * 60 * 60);

/// Rows deleted (or, on a dry run, that would be deleted) per table.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct PurgeReport {
    pub review_log: u64,
    pub card_states: u64,
    pub audio_assets: u64,
    pub cards: u64,
    pub decks: u64,
}

impl fmt::Display for PurgeReport {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "decks {}, cards {}, card_states {}, review_log {}, audio_assets {}",
            self.decks, self.cards, self.card_states, self.review_log, self.audio_assets
        )
    }
}

/// Deletes, in one transaction and children before parents (foreign keys are on):
/// - decks soft-deleted before the cutoff (`now − older_than_days`);
/// - cards soft-deleted before the cutoff, and every card of such a deck;
/// - the states, answers and clips of those cards;
/// - states and answers soft-deleted before the cutoff (an undone answer of a live card);
/// - clips that no card points to (`cards.audio_id`) and that are older than a day.
///
/// Rows that are not soft-deleted, or were deleted after the cutoff, are never touched (except clips no card uses).
/// With `dry_run` the transaction is rolled back: the report says what would be deleted.
pub async fn purge(
    pool: &SqlitePool,
    now: i64,
    older_than_days: u32,
    dry_run: bool,
) -> Result<PurgeReport, AppError> {
    let cutoff = now - i64::from(older_than_days) * DAY_MS;
    let orphan_before = now - ORPHAN_AUDIO_MIN_AGE_MS;
    let mut tx = pool.begin_with("BEGIN IMMEDIATE").await?;

    // "Purged cards": soft-deleted before the cutoff, or in a deck that is.
    let review_log = sqlx::query!(
        "DELETE FROM review_log WHERE deleted_at < ?1 OR card_id IN (
           SELECT id FROM cards WHERE deleted_at < ?1
             OR deck_id IN (SELECT id FROM decks WHERE deleted_at < ?1))",
        cutoff,
    )
    .execute(&mut *tx)
    .await?
    .rows_affected();
    let card_states = sqlx::query!(
        "DELETE FROM card_states WHERE deleted_at < ?1 OR card_id IN (
           SELECT id FROM cards WHERE deleted_at < ?1
             OR deck_id IN (SELECT id FROM decks WHERE deleted_at < ?1))",
        cutoff,
    )
    .execute(&mut *tx)
    .await?
    .rows_affected();
    let card_audio = sqlx::query!(
        "DELETE FROM audio_assets WHERE card_id IN (
           SELECT id FROM cards WHERE deleted_at < ?1
             OR deck_id IN (SELECT id FROM decks WHERE deleted_at < ?1))",
        cutoff,
    )
    .execute(&mut *tx)
    .await?
    .rows_affected();
    let cards = sqlx::query!(
        "DELETE FROM cards WHERE deleted_at < ?1
           OR deck_id IN (SELECT id FROM decks WHERE deleted_at < ?1)",
        cutoff,
    )
    .execute(&mut *tx)
    .await?
    .rows_affected();
    let decks = sqlx::query!("DELETE FROM decks WHERE deleted_at < ?", cutoff)
        .execute(&mut *tx)
        .await?
        .rows_affected();
    let orphan_audio = sqlx::query!(
        "DELETE FROM audio_assets WHERE created_at < ?
           AND NOT EXISTS (SELECT 1 FROM cards WHERE cards.audio_id = audio_assets.id)",
        orphan_before,
    )
    .execute(&mut *tx)
    .await?
    .rows_affected();

    if dry_run {
        tx.rollback().await?;
    } else {
        tx.commit().await?;
    }
    Ok(PurgeReport {
        review_log,
        card_states,
        audio_assets: card_audio + orphan_audio,
        cards,
        decks,
    })
}

/// Runs the purge once a day, the first time a few minutes after startup. A failed run is logged and retried the
/// next day.
pub fn spawn_daily_purge(pool: SqlitePool) {
    tokio::spawn(async move {
        let mut daily = interval_at(Instant::now() + FIRST_RUN_DELAY, RUN_INTERVAL);
        loop {
            daily.tick().await;
            run_scheduled(&pool, now_ms()).await;
        }
    });
}

/// One scheduled run: purge with the default retention and log the result.
async fn run_scheduled(pool: &SqlitePool, now: i64) {
    match purge(pool, now, RETENTION_DAYS, false).await {
        Ok(report) => tracing::info!(
            decks = report.decks,
            cards = report.cards,
            card_states = report.card_states,
            review_log = report.review_log,
            audio_assets = report.audio_assets,
            "purge finished"
        ),
        Err(err) => tracing::warn!(error = %err, "purge failed"),
    }
}

#[cfg(test)]
mod tests;
