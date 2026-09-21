import { newCardState } from '../directions'
import type { Card, CardState, Deck, Direction, Directions, ReviewLog } from '../types'

// Builders for study-engine tests. Times are ms since the epoch; the test setup fixes TZ = Europe/Riga.

const stamp = { updated_at: 1, updated_by: 'test', deleted_at: null }

export function deck(id: string, extra: Partial<Deck> & { directions?: Directions } = {}): Deck {
  return {
    id,
    name: id,
    target_lang: 'en-GB',
    native_lang: 'ru',
    directions: 'forward',
    new_per_day: null,
    archived_at: null,
    created_at: 1,
    ...stamp,
    ...extra,
  }
}

export function card(id: string, deck_id: string, extra: Partial<Card> = {}): Card {
  return {
    id,
    deck_id,
    front: id,
    back: id,
    example: null,
    example_translation: null,
    ipa: null,
    tags: [],
    notes: null,
    audio_id: null,
    created_at: 1,
    ...stamp,
    ...extra,
  }
}

export function state(card_id: string, extra: Partial<CardState> & { direction?: Direction } = {}): CardState {
  return { ...newCardState(card_id, extra.direction ?? 'forward', 0), ...extra }
}

/** A Review state due at `due`. */
export function review(card_id: string, due: number, extra: Partial<CardState> = {}): CardState {
  return state(card_id, {
    state: 2,
    due,
    stability: 10,
    difficulty: 5,
    reps: 3,
    last_review: due - 86_400_000,
    ...extra,
  })
}

let logCounter = 0

export function log(card_id: string, reviewed_at: number, extra: Partial<ReviewLog> = {}): ReviewLog {
  const { card_id: _c, direction: _d, updated_at: _u, updated_by: _b, deleted_at: _x, ...before } = state(card_id)
  return {
    id: `log-${logCounter++}`,
    card_id,
    direction: 'forward',
    rating: 3,
    mode: 'swipe',
    state_before: before,
    reviewed_at,
    duration_ms: 1000,
    practice: false,
    ...stamp,
    ...extra,
  }
}

export const settings = { new_per_day: 15, max_reviews_per_day: 200 }
