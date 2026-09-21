import { activeDirections } from './directions'
import type { CardState, Deck } from './types'

/** A review state counts as mature once its interval reaches 21 days (a common SRS convention). */
export const MATURE_DAYS = 21

export type DeckSummary = {
  cards: number
  /** Counts of card states in the deck's active directions. */
  new: number
  learning: number
  mature: number
  /** Non-new states with `due <= now`. P1-T07 replaces this with the study-day-aware count. */
  due: number
}

/** Counts for a deck row (S-05). `states` are the non-deleted states of the deck's non-deleted cards. */
export function summarizeDeck(deck: Deck, cardCount: number, states: CardState[], now: number): DeckSummary {
  const directions = new Set(activeDirections(deck.directions))
  const summary: DeckSummary = { cards: cardCount, new: 0, learning: 0, mature: 0, due: 0 }
  for (const state of states) {
    if (!directions.has(state.direction)) continue
    if (state.state === 0) {
      summary.new += 1
      continue
    }
    if (state.state === 2 && state.scheduled_days >= MATURE_DAYS) summary.mature += 1
    else summary.learning += 1
    if (state.due <= now) summary.due += 1
  }
  return summary
}
