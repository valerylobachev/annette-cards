//! Attaching audio to a card and removing it (architecture.md §7).
//!
//! The card is a synced row, so a server-side edit follows the sync rules: it gets a new LWW stamp (`updated_by =
//! "server"`) and a fresh `server_seq`, otherwise other devices would never pull it and a stale push could undo it.

use sqlx::{SqliteConnection, SqlitePool};

use crate::{
    audio::{
        dto::AttachAudioResponse,
        store::{self, NewAsset, SOURCE_AZURE},
        tts::{TtsError, TtsProvider, TtsRequest},
    },
    error::AppError,
    sync::seq::next_seq,
};

/// `updated_by` of card edits made by the server itself.
pub const SERVER_DEVICE: &str = "server";

/// What the providers need to know about a card.
struct CardForAudio {
    front: String,
    ipa: Option<String>,
    target_lang: String,
}

/// Generates speech for the card's front in its deck's language and attaches it to the card.
///
/// The provider is called before the transaction starts: a slow or failing provider never holds the database write
/// lock, and on failure nothing is written.
pub async fn attach_tts(
    pool: &SqlitePool,
    tts: &dyn TtsProvider,
    user_id: &str,
    card_id: &str,
    voice: Option<String>,
    now: i64,
) -> Result<AttachAudioResponse, AppError> {
    let card = load_card(pool, user_id, card_id).await?;
    let request = TtsRequest {
        text: card.front,
        lang: card.target_lang,
        ipa: card.ipa,
        voice,
    };
    let audio = tts
        .synthesize(&request)
        .await
        .map_err(|error| match error {
            TtsError::UnsupportedLanguage(_) => AppError::BadRequest("unsupported_language"),
            TtsError::Provider(message) => {
                tracing::warn!(error = %message, "tts provider failed");
                AppError::ProviderError
            }
        })?;

    let mut tx = pool.begin_with("BEGIN IMMEDIATE").await?;
    let asset = NewAsset {
        user_id,
        card_id,
        source: SOURCE_AZURE,
        mime: &audio.mime,
        voice: Some(&audio.voice),
        attribution: None,
        bytes: &audio.bytes,
    };
    let audio_id = store::insert_asset(&mut tx, asset, now).await?;
    if !set_card_audio(&mut tx, user_id, card_id, Some(&audio_id), now).await? {
        // The card was deleted while the provider was working.
        return Err(AppError::NotFound);
    }
    tx.commit().await?;

    Ok(AttachAudioResponse {
        audio_id,
        attribution: None,
    })
}

/// Clears the card's `audio_id`. The clip itself stays (purged later by maintenance), so a device that cached it
/// can still play it until it pulls the change. Removing audio from a card without audio changes nothing.
pub async fn remove_audio(
    pool: &SqlitePool,
    user_id: &str,
    card_id: &str,
    now: i64,
) -> Result<(), AppError> {
    let mut tx = pool.begin_with("BEGIN IMMEDIATE").await?;
    let audio_id = sqlx::query_scalar!(
        "SELECT audio_id FROM cards WHERE id = ? AND user_id = ? AND deleted_at IS NULL",
        card_id,
        user_id
    )
    .fetch_optional(&mut *tx)
    .await?
    .ok_or(AppError::NotFound)?;
    if audio_id.is_some() {
        set_card_audio(&mut tx, user_id, card_id, None, now).await?;
    }
    tx.commit().await?;
    Ok(())
}

/// The user's card, if neither it nor its deck is deleted.
async fn load_card(
    pool: &SqlitePool,
    user_id: &str,
    card_id: &str,
) -> Result<CardForAudio, AppError> {
    sqlx::query_as!(
        CardForAudio,
        "SELECT c.front, c.ipa, d.target_lang FROM cards c JOIN decks d ON d.id = c.deck_id
         WHERE c.id = ? AND c.user_id = ? AND d.user_id = c.user_id
           AND c.deleted_at IS NULL AND d.deleted_at IS NULL",
        card_id,
        user_id
    )
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)
}

/// Sets `audio_id` with a server stamp and a new `server_seq`; `false` when the card is gone.
///
/// `updated_at` is `now`, but always later than the card's current stamp: a device whose clock runs ahead may have
/// stamped the card "in the future", and an older stamp would lose last-write-wins on every device.
async fn set_card_audio(
    tx: &mut SqliteConnection,
    user_id: &str,
    card_id: &str,
    audio_id: Option<&str>,
    now: i64,
) -> Result<bool, AppError> {
    let seq = next_seq(tx).await?;
    let result = sqlx::query!(
        "UPDATE cards SET audio_id = ?, updated_at = MAX(?, updated_at + 1), updated_by = ?, server_seq = ?
         WHERE id = ? AND user_id = ? AND deleted_at IS NULL",
        audio_id,
        now,
        SERVER_DEVICE,
        seq,
        card_id,
        user_id
    )
    .execute(&mut *tx)
    .await?;
    Ok(result.rows_affected() == 1)
}
