import type { CardState, Direction, Directions } from './types'

/** Directions a deck setting turns on (architecture.md §4.4 "Directions"). */
export function activeDirections(directions: Directions): Direction[] {
  if (directions === 'both') return ['forward', 'reverse']
  return [directions]
}

/**
 * A New state for one card direction, shaped like a ts-fsrs empty card (`createEmptyCard`): due now, zero
 * stability/difficulty and counters. The stamp fields are set by the repository that writes it.
 */
export function newCardState(card_id: string, direction: Direction, now: number): CardState {
  return {
    card_id,
    direction,
    state: 0,
    due: now,
    stability: 0,
    difficulty: 0,
    elapsed_days: 0,
    scheduled_days: 0,
    learning_steps: 0,
    reps: 0,
    lapses: 0,
    last_review: null,
    updated_at: now,
    updated_by: '',
    deleted_at: null,
  }
}
