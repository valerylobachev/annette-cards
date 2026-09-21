import { describe, expect, it } from 'vitest'
import { snapshotOf } from '../fsrs'
import type { SessionInput } from '../session'
import { summarizeSession } from '../sessionSummary'
import { todaySummary } from '../today'
import { card, deck, log, review, settings, state } from './fixtures'

const NOW = new Date(2026, 8, 21, 12, 0).getTime()
const HOUR = 3_600_000

function input(extra: Partial<SessionInput>): SessionInput {
  return { decks: [], cards: [], states: [], logsToday: [], settings, extraNew: 0, ...extra }
}

describe('todaySummary', () => {
  it('counts reviews and new cards, the estimate and the decks due', () => {
    const summary = todaySummary(
      input({
        decks: [deck('a', { name: 'Alpha' }), deck('b', { name: 'Beta' }), deck('c', { name: 'Empty' })],
        cards: [card('r1', 'a'), card('r2', 'a'), card('n1', 'b'), card('later', 'c')],
        states: [review('r1', NOW - HOUR), review('r2', NOW - HOUR), state('n1'), review('later', NOW + 3 * HOUR)],
      }),
      NOW,
    )
    expect(summary).toMatchObject({ reviewsDue: 2, newAvailable: 1, estimateMin: 1, nextDueAt: NOW + 3 * HOUR })
    expect(summary.decksDue.map(({ deck, due }) => [deck.name, due])).toEqual([
      ['Alpha', 2],
      ['Beta', 1],
    ])
  })

  it('offers extra new words only when new cards are waiting beyond the limit', () => {
    const fresh = Array.from({ length: 20 }, (_, i) => card(`n${i}`, 'd', { created_at: i }))
    const base = {
      decks: [deck('d')],
      cards: fresh,
      states: fresh.map((c) => state(c.id)),
      logsToday: [],
    }
    expect(todaySummary(input(base), NOW)).toMatchObject({ newAvailable: 15, moreNewWaiting: true })
    const few = { ...base, cards: fresh.slice(0, 3), states: fresh.slice(0, 3).map((c) => state(c.id)) }
    expect(todaySummary(input(few), NOW)).toMatchObject({ newAvailable: 3, moreNewWaiting: false })
  })

  it('reports nothing due with the practice option for difficult cards', () => {
    const summary = todaySummary(
      input({
        decks: [deck('d')],
        cards: [card('hard', 'd')],
        states: [review('hard', NOW + 5 * HOUR, { lapses: 4 })],
        logsToday: [log('hard', NOW - HOUR)],
      }),
      NOW,
    )
    expect(summary).toMatchObject({ reviewsDue: 0, newAvailable: 0, decksDue: [], practiceAvailable: true })
  })
})

describe('summarizeSession', () => {
  it('computes accuracy 75 % for 3 Good and 1 Again, time, new words and the difficult cards', () => {
    // `log()` answers a New card unless `state_before` says otherwise.
    const reviewed = { state_before: snapshotOf(review('x', 0)) }
    const summary = summarizeSession([
      log('a', 1, { rating: 1, duration_ms: 4000 }),
      log('a', 2, { rating: 3, duration_ms: 2000, ...reviewed }),
      log('b', 3, { rating: 3, duration_ms: 3000, ...reviewed }),
      log('c', 4, { rating: 4, duration_ms: 1000, ...reviewed }),
      log('d', 5, { rating: 1, deleted_at: 6 }),
    ])
    expect(summary).toEqual({
      cardsReviewed: 3,
      answers: 4,
      accuracy: 0.75,
      timeMs: 10_000,
      newLearned: 1,
      difficultCardIds: ['a'],
    })
  })
})
