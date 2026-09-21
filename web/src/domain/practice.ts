import { DIFFICULT_LAPSES } from './cardFilters'
import { activeDirections } from './directions'
import type { QueueItem } from './session'
import type { Card, CardState, Deck } from './types'

/** Stability below this many days makes a studied card "difficult". */
export const LOW_STABILITY_DAYS = 2
export const PRACTICE_LIMIT = 50

export type PracticeInput = {
  decks: Deck[]
  cards: Card[]
  states: CardState[]
  deckFilter?: string
  /** Cards answered Again in the last session ("Repeat these now", S-12). */
  failedIds?: string[]
  /** Practice only `failedIds` ("Repeat these now"), without the other difficult cards. */
  onlyFailed?: boolean
}

/**
 * Practice queue (UC-16): studied directions with lapses ≥ 3 or stability < 2 days, plus every studied direction of
 * the cards failed in the last session; most lapses first, then lowest stability; at most 50. Same eligibility as
 * the study queue (live card, live non-archived deck, active direction). New directions are never practiced.
 */
export function buildPracticeQueue({
  decks,
  cards,
  states,
  deckFilter,
  failedIds = [],
  onlyFailed = false,
}: PracticeInput): QueueItem[] {
  const liveDecks = new Map(
    decks
      .filter((deck) => deck.deleted_at === null && deck.archived_at === null)
      .filter((deck) => deckFilter === undefined || deck.id === deckFilter)
      .map((deck) => [deck.id, deck]),
  )
  const deckOfCard = new Map(
    cards.filter((card) => card.deleted_at === null).map((card) => [card.id, liveDecks.get(card.deck_id)]),
  )
  const failed = new Set(failedIds)
  return states
    .filter((state) => {
      const deck = deckOfCard.get(state.card_id)
      if (!deck || state.deleted_at !== null || state.state === 0) return false
      if (!activeDirections(deck.directions).includes(state.direction)) return false
      if (failed.has(state.card_id)) return true
      return !onlyFailed && (state.lapses >= DIFFICULT_LAPSES || state.stability < LOW_STABILITY_DAYS)
    })
    .sort((a, b) => b.lapses - a.lapses || a.stability - b.stability)
    .slice(0, PRACTICE_LIMIT)
    .map((state) => ({
      card_id: state.card_id,
      direction: state.direction,
      kind: state.state === 2 ? 'review' : 'learning',
    }))
}
