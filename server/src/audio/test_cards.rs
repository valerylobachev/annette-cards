//! Cards for audio tests, written through the sync push like a device would.

use sqlx::SqlitePool;
use uuid::Uuid;

use crate::sync::{
    dto::Changes,
    push,
    test_rows::{card_row, deck_row},
};

/// When the sample deck and card were last edited on the device.
pub const CARD_UPDATED_AT: i64 = 1_000;

/// Pushes an `en-GB` deck with one card and returns the card id.
pub async fn insert_card(
    pool: &SqlitePool,
    user_id: &str,
    front: &str,
    ipa: Option<&str>,
) -> String {
    insert_card_in(pool, user_id, "en-GB", front, ipa).await
}

/// Like `insert_card`, with the deck's study language.
pub async fn insert_card_in(
    pool: &SqlitePool,
    user_id: &str,
    target_lang: &str,
    front: &str,
    ipa: Option<&str>,
) -> String {
    let deck_id = Uuid::now_v7().to_string();
    let card_id = Uuid::now_v7().to_string();
    let mut deck = deck_row(&deck_id, CARD_UPDATED_AT);
    deck.target_lang = target_lang.to_string();
    let mut card = card_row(&card_id, &deck_id, CARD_UPDATED_AT);
    card.front = front.to_string();
    card.ipa = ipa.map(str::to_string);
    let changes = Changes {
        decks: vec![deck],
        cards: vec![card],
        ..Changes::default()
    };
    let response = push::push(pool, user_id, &changes, CARD_UPDATED_AT)
        .await
        .unwrap();
    assert!(response.rejected.is_empty(), "{:?}", response.rejected);
    card_id
}
