//! `audio_assets`: pronunciation clips stored as BLOBs (ADR-6). Every query filters by `user_id`.

use sqlx::{SqliteConnection, SqlitePool};
use uuid::Uuid;

use crate::error::AppError;

/// Where a clip came from; stored in `audio_assets.source` and sent as `X-Audio-Source`.
pub const SOURCE_AZURE: &str = "azure";
pub const SOURCE_COMMONS: &str = "commons";

/// A clip to store for one of the user's cards.
pub struct NewAsset<'a> {
    pub user_id: &'a str,
    pub card_id: &'a str,
    pub source: &'a str,
    pub mime: &'a str,
    pub voice: Option<&'a str>,
    pub attribution: Option<&'a str>,
    pub bytes: &'a [u8],
}

#[derive(Debug)]
pub struct AudioAsset {
    pub source: String,
    pub mime: String,
    pub attribution: Option<String>,
    pub bytes: Vec<u8>,
}

/// Inserts a clip with a new UUIDv7 id and returns the id. Runs on the caller's transaction, so the clip and the
/// card that points to it are written together.
pub async fn insert_asset(
    conn: &mut SqliteConnection,
    asset: NewAsset<'_>,
    now: i64,
) -> Result<String, AppError> {
    let id = Uuid::now_v7().to_string();
    sqlx::query!(
        "INSERT INTO audio_assets (id, user_id, card_id, source, mime, voice, attribution, bytes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        id,
        asset.user_id,
        asset.card_id,
        asset.source,
        asset.mime,
        asset.voice,
        asset.attribution,
        asset.bytes,
        now,
    )
    .execute(conn)
    .await?;
    Ok(id)
}

/// The user's clip, or `None` when it does not exist or belongs to someone else.
pub async fn get_asset(
    pool: &SqlitePool,
    user_id: &str,
    id: &str,
) -> Result<Option<AudioAsset>, AppError> {
    let asset = sqlx::query_as!(
        AudioAsset,
        "SELECT source, mime, attribution, bytes FROM audio_assets WHERE id = ? AND user_id = ?",
        id,
        user_id
    )
    .fetch_optional(pool)
    .await?;
    Ok(asset)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{audio::test_cards, test_support::create_user};

    #[sqlx::test]
    async fn a_clip_is_visible_only_to_its_owner(pool: SqlitePool) {
        let anna = create_user(&pool, "anna@example.com", false).await;
        let boris = create_user(&pool, "boris@example.com", false).await;
        let card_id = test_cards::insert_card(&pool, &anna.id, "read", None).await;

        let mut conn = pool.acquire().await.unwrap();
        let new = NewAsset {
            user_id: &anna.id,
            card_id: &card_id,
            source: SOURCE_AZURE,
            mime: "audio/mpeg",
            voice: Some("en-GB-SoniaNeural"),
            attribution: None,
            bytes: b"ID3 fake mp3",
        };
        let id = insert_asset(&mut conn, new, 1_000).await.unwrap();
        drop(conn);

        let asset = get_asset(&pool, &anna.id, &id).await.unwrap().unwrap();
        assert_eq!(asset.source, "azure");
        assert_eq!(asset.mime, "audio/mpeg");
        assert_eq!(asset.bytes, b"ID3 fake mp3");
        assert_eq!(Uuid::parse_str(&id).unwrap().get_version_num(), 7);

        assert!(get_asset(&pool, &boris.id, &id).await.unwrap().is_none());
        assert!(
            get_asset(&pool, &anna.id, "missing")
                .await
                .unwrap()
                .is_none()
        );
    }
}
