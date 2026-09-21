// Entities stored in Dexie and synced with the server. Field names mirror architecture.md §5.4 without the
// server-only `user_id` and `server_seq`. All timestamps are milliseconds since the epoch.

export type Directions = 'forward' | 'reverse' | 'both'
export type Direction = 'forward' | 'reverse'

/** Fields every synced row carries (architecture.md §6.1, last-write-wins). */
export type SyncStamp = {
  updated_at: number
  /** Device id of the writer. */
  updated_by: string
}

export type Deck = SyncStamp & {
  id: string
  name: string
  /** BCP-47, e.g. `en-GB`, `pl-PL`. */
  target_lang: string
  /** BCP-47, e.g. `ru`. */
  native_lang: string
  directions: Directions
  /** `null` = use the global `new_per_day` setting. */
  new_per_day: number | null
  archived_at: number | null
  created_at: number
  deleted_at: number | null
}

export type Card = SyncStamp & {
  id: string
  deck_id: string
  front: string
  back: string
  example: string | null
  example_translation: string | null
  ipa: string | null
  tags: string[]
  notes: string | null
  audio_id: string | null
  created_at: number
  deleted_at: number | null
}

/** FSRS state: 0 New, 1 Learning, 2 Review, 3 Relearning (same numbers as ts-fsrs `State`). */
export type FsrsState = 0 | 1 | 2 | 3

/** Scheduling fields of one card direction; also the snapshot stored in `review_log.state_before`. */
export type CardStateSnapshot = {
  state: FsrsState
  due: number
  stability: number
  difficulty: number
  elapsed_days: number
  scheduled_days: number
  learning_steps: number
  reps: number
  lapses: number
  last_review: number | null
}

export type CardState = SyncStamp &
  CardStateSnapshot & {
    card_id: string
    direction: Direction
    deleted_at: number | null
  }

/** 1 Again, 2 Hard, 3 Good, 4 Easy. */
export type Rating = 1 | 2 | 3 | 4
export type ReviewMode = 'swipe' | 'choice' | 'listen' | 'typing'

export type ReviewLog = SyncStamp & {
  id: string
  card_id: string
  direction: Direction
  rating: Rating
  mode: ReviewMode
  state_before: CardStateSnapshot
  reviewed_at: number
  duration_ms: number
  deleted_at: number | null
}

export type UiLanguage = 'en' | 'ru'
export type AnswerMode = 'simple' | 'detailed'
/** S-14: Off / Front / Front and answer. */
export type Autoplay = 'off' | 'front' | 'front_and_back'

/** The synced settings document (architecture.md §5.5). */
export type Settings = {
  ui_language: UiLanguage
  /** Local hour when a study day starts. */
  day_start_hour: number
  new_per_day: number
  max_reviews_per_day: number
  answer_mode: AnswerMode
  desired_retention: number
  fsrs_weights: number[] | null
  autoplay: Autoplay
  reminder: { enabled: boolean; time: string; tz: string }
  /** Default directions for new decks (decision D3). */
  default_directions: Directions
  /** Show the IPA on the front of a study card (decision D3). */
  show_ipa_on_front: boolean
}

/** Tables whose rows are pushed to the server by the sync engine. */
export type SyncedEntity = 'decks' | 'cards' | 'card_states' | 'review_log' | 'settings'
