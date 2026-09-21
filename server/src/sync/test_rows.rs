//! Valid sample rows for sync tests. `updated_at` is the LWW timestamp; the device is `device-a`.

use serde_json::json;

use crate::sync::dto::{
    CardDto, CardStateDto, DeckDto, Direction, Directions, ReviewLogDto, ReviewMode,
};

pub const DEVICE: &str = "device-a";

pub fn deck_row(id: &str, updated_at: i64) -> DeckDto {
    DeckDto {
        id: id.to_string(),
        name: format!("Deck {id}"),
        target_lang: "en-GB".to_string(),
        native_lang: "ru".to_string(),
        directions: Directions::Both,
        new_per_day: None,
        archived_at: None,
        created_at: 1,
        updated_at,
        updated_by: DEVICE.to_string(),
        deleted_at: None,
    }
}

pub fn card_row(id: &str, deck_id: &str, updated_at: i64) -> CardDto {
    CardDto {
        id: id.to_string(),
        deck_id: deck_id.to_string(),
        front: format!("front {id}"),
        back: format!("back {id}"),
        example: None,
        example_translation: None,
        ipa: None,
        tags: vec!["verbs".to_string()],
        notes: None,
        audio_id: None,
        created_at: 1,
        updated_at,
        updated_by: DEVICE.to_string(),
        deleted_at: None,
    }
}

pub fn state_row(card_id: &str, updated_at: i64) -> CardStateDto {
    CardStateDto {
        card_id: card_id.to_string(),
        direction: Direction::Forward,
        state: 0,
        due: 1_000,
        stability: 0.0,
        difficulty: 0.0,
        elapsed_days: 0,
        scheduled_days: 0,
        learning_steps: 0,
        reps: 0,
        lapses: 0,
        last_review: None,
        updated_at,
        updated_by: DEVICE.to_string(),
        deleted_at: None,
    }
}

pub fn log_row(id: &str, card_id: &str) -> ReviewLogDto {
    ReviewLogDto {
        id: id.to_string(),
        card_id: card_id.to_string(),
        direction: Direction::Forward,
        rating: 3,
        mode: ReviewMode::Swipe,
        state_before: json!({ "state": 0, "due": 1000, "stability": 0, "difficulty": 0, "elapsed_days": 0,
                              "scheduled_days": 0, "learning_steps": 0, "reps": 0, "lapses": 0,
                              "last_review": null }),
        reviewed_at: 2_000,
        duration_ms: 1_500,
        practice: false,
        updated_at: 2_000,
        updated_by: DEVICE.to_string(),
        deleted_at: None,
    }
}
