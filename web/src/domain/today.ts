import { estimateMinutes } from './estimate'
import { buildPracticeQueue } from './practice'
import { buildSession, eligibleStates, type QueueItem, type SessionInput } from './session'
import type { Deck } from './types'

const countNew = (queue: QueueItem[]) => queue.filter((item) => item.kind === 'new').length

export type DeckDue = { deck: Deck; due: number }

export type TodaySummary = {
  /** Learning and review cards in today's queue. */
  reviewsDue: number
  /** New cards in today's queue (within the daily limits). */
  newAvailable: number
  estimateMin: number
  /** Decks with cards to study, with the size of a session limited to that deck. */
  decksDue: DeckDue[]
  /** When the next studied card becomes due; `null` when there is none. */
  nextDueAt: number | null
  /** New cards beyond today's limit exist, so "Learn extra new words" has something to add. */
  moreNewWaiting: boolean
  /** "Practice difficult words" has cards. */
  practiceAvailable: boolean
}

/** Counts for Today (S-04), from the same queue rules as the study session. */
export function todaySummary(input: SessionInput, now: number): TodaySummary {
  const queue = buildSession(input, now)
  const newAvailable = countNew(queue)
  const { liveDecks, eligible } = eligibleStates(input)
  const decksDue = [...liveDecks.values()]
    .map((deck) => ({ deck, due: buildSession({ ...input, deckFilter: deck.id }, now).length }))
    .filter(({ due }) => due > 0)
    .sort((a, b) => b.due - a.due || a.deck.name.localeCompare(b.deck.name))
  const later = eligible.filter((state) => state.state !== 0 && state.due > now).map((state) => state.due)
  return {
    reviewsDue: queue.length - newAvailable,
    newAvailable,
    estimateMin: estimateMinutes(queue),
    decksDue,
    nextDueAt: later.length > 0 ? Math.min(...later) : null,
    moreNewWaiting: countNew(buildSession({ ...input, extraNew: input.extraNew + 1 }, now)) > newAvailable,
    practiceAvailable: buildPracticeQueue(input).length > 0,
  }
}
