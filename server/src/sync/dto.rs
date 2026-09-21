//! Sync payloads (architecture.md §6.3). Field names are exactly the client's Dexie rows (`web/src/domain/types.ts`)
//! without `user_id` and `server_seq`, which only the server sets.

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// Which directions of a deck are studied.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema, sqlx::Type)]
#[serde(rename_all = "snake_case")]
#[sqlx(rename_all = "snake_case")]
pub enum Directions {
    Forward,
    Reverse,
    Both,
}

/// One study direction of a card.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema, sqlx::Type)]
#[serde(rename_all = "snake_case")]
#[sqlx(rename_all = "snake_case")]
pub enum Direction {
    Forward,
    Reverse,
}

impl Direction {
    pub fn as_str(self) -> &'static str {
        match self {
            Direction::Forward => "forward",
            Direction::Reverse => "reverse",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema, sqlx::Type)]
#[serde(rename_all = "snake_case")]
#[sqlx(rename_all = "snake_case")]
pub enum ReviewMode {
    Swipe,
    Choice,
    Listen,
    Typing,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct DeckDto {
    pub id: String,
    pub name: String,
    /// BCP-47, e.g. `en-GB`.
    pub target_lang: String,
    pub native_lang: String,
    pub directions: Directions,
    /// `null` = the global `new_per_day` setting.
    pub new_per_day: Option<i64>,
    pub archived_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
    /// Device id of the writer.
    pub updated_by: String,
    pub deleted_at: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct CardDto {
    pub id: String,
    pub deck_id: String,
    pub front: String,
    pub back: String,
    pub example: Option<String>,
    pub example_translation: Option<String>,
    pub ipa: Option<String>,
    pub tags: Vec<String>,
    pub notes: Option<String>,
    pub audio_id: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub updated_by: String,
    pub deleted_at: Option<i64>,
}

/// FSRS state of one card direction, stored as the client computed it (the server never reschedules).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct CardStateDto {
    pub card_id: String,
    pub direction: Direction,
    /// 0 New, 1 Learning, 2 Review, 3 Relearning.
    pub state: i64,
    pub due: i64,
    pub stability: f64,
    pub difficulty: f64,
    pub elapsed_days: i64,
    pub scheduled_days: i64,
    pub learning_steps: i64,
    pub reps: i64,
    pub lapses: i64,
    pub last_review: Option<i64>,
    pub updated_at: i64,
    pub updated_by: String,
    pub deleted_at: Option<i64>,
}

impl CardStateDto {
    /// How a card state is named in push responses: `"{card_id}:{direction}"`.
    pub fn key(&self) -> String {
        format!("{}:{}", self.card_id, self.direction.as_str())
    }
}

/// One answer. Append-only: after the first push only `deleted_at` (undo) may change.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct ReviewLogDto {
    pub id: String,
    pub card_id: String,
    pub direction: Direction,
    /// 1 Again, 2 Hard, 3 Good, 4 Easy.
    pub rating: i64,
    pub mode: ReviewMode,
    /// The card state before the answer (JSON object with the `CardStateDto` scheduling fields).
    pub state_before: serde_json::Value,
    pub reviewed_at: i64,
    pub duration_ms: i64,
    /// Answered in practice mode (UC-16, decision D2).
    pub practice: bool,
    pub updated_at: i64,
    pub updated_by: String,
    pub deleted_at: Option<i64>,
}

/// The settings document (architecture.md §5.5) with its LWW stamp. `data` holds only the fields set by the user.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct SettingsDto {
    pub data: serde_json::Value,
    pub updated_at: i64,
    pub updated_by: String,
}

/// Rows of every synced entity. Missing arrays count as empty.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct Changes {
    #[serde(default)]
    pub decks: Vec<DeckDto>,
    #[serde(default)]
    pub cards: Vec<CardDto>,
    #[serde(default)]
    pub card_states: Vec<CardStateDto>,
    #[serde(default)]
    pub review_log: Vec<ReviewLogDto>,
    #[serde(default)]
    pub settings: Option<SettingsDto>,
}

impl Changes {
    pub fn row_count(&self) -> usize {
        self.decks.len()
            + self.cards.len()
            + self.card_states.len()
            + self.review_log.len()
            + usize::from(self.settings.is_some())
    }
}

#[derive(Debug, Clone, Deserialize, ToSchema)]
pub struct PushRequest {
    /// The pushing device (for logs).
    pub device_id: String,
    pub changes: Changes,
}

/// The synced entities, as named in payloads.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum SyncEntity {
    Decks,
    Cards,
    CardStates,
    ReviewLog,
    Settings,
}

/// Row ids per entity; card states as `"{card_id}:{direction}"`, settings as a flag.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct EntityIds {
    pub decks: Vec<String>,
    pub cards: Vec<String>,
    pub card_states: Vec<String>,
    pub review_log: Vec<String>,
    pub settings: bool,
}

/// A row the server refused; the client keeps it out of the outbox and logs it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct Rejected {
    pub entity: SyncEntity,
    /// Row id (`"{card_id}:{direction}"` for card states, `"settings"` for settings).
    pub id: String,
    /// `validation_failed`, `not_owned`, `deck_not_owned` or `card_not_owned`.
    pub code: String,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct PushResponse {
    /// Written on the server (new or newer than the stored row).
    pub applied: EntityIds,
    /// Not written because the server's row wins last-write-wins (or is identical); the client gets it on pull.
    pub skipped: EntityIds,
    pub rejected: Vec<Rejected>,
    /// Server clock, for the client's clock-skew warning.
    pub server_time: i64,
}
