import { describe, expect, it } from 'vitest'
import { dailyCounters } from '../counters'
import { buildPracticeQueue } from '../practice'
import { buildSession } from '../session'
import { card, deck, log, review, settings, state } from './fixtures'

const NOW = new Date(2026, 8, 21, 12, 0).getTime()

describe('buildPracticeQueue', () => {
  it('practices only the failed cards for "Repeat these now"', () => {
    const queue = buildPracticeQueue({
      decks: [deck('d')],
      cards: [card('failed', 'd'), card('lapsed', 'd')],
      states: [review('failed', NOW, { stability: 30 }), review('lapsed', NOW, { lapses: 5 })],
      failedIds: ['failed'],
      onlyFailed: true,
    })
    expect(queue.map((item) => item.card_id)).toEqual(['failed'])
  })

  it('takes lapsed and unstable studied directions, most lapses first, never New ones', () => {
    const queue = buildPracticeQueue({
      decks: [deck('d', { directions: 'both' })],
      cards: ['stable', 'lapsed', 'very-lapsed', 'shaky', 'fresh'].map((id) => card(id, 'd')),
      states: [
        review('stable', NOW, { stability: 30, lapses: 1 }),
        review('lapsed', NOW, { stability: 20, lapses: 3 }),
        review('very-lapsed', NOW, { stability: 20, lapses: 6, direction: 'reverse' }),
        review('shaky', NOW, { stability: 1.2 }),
        state('fresh'),
      ],
    })
    expect(queue).toEqual([
      { card_id: 'very-lapsed', direction: 'reverse', kind: 'review' },
      { card_id: 'lapsed', direction: 'forward', kind: 'review' },
      { card_id: 'shaky', direction: 'forward', kind: 'review' },
    ])
  })

  it('adds the cards failed in the last session and respects the deck filter and archived decks', () => {
    const queue = buildPracticeQueue({
      decks: [deck('a'), deck('b'), deck('archived', { archived_at: 1 })],
      cards: [card('failed', 'a'), card('other-deck', 'b'), card('in-archived', 'archived')],
      states: [
        review('failed', NOW, { stability: 30 }),
        review('other-deck', NOW, { lapses: 5 }),
        review('in-archived', NOW, { lapses: 5 }),
      ],
      failedIds: ['failed'],
      deckFilter: 'a',
    })
    expect(queue.map((item) => item.card_id)).toEqual(['failed'])
  })

  it('returns at most 50 items', () => {
    const cards = Array.from({ length: 60 }, (_, i) => card(`c${i}`, 'd'))
    const queue = buildPracticeQueue({
      decks: [deck('d')],
      cards,
      states: cards.map((c) => review(c.id, NOW, { lapses: 4 })),
    })
    expect(queue).toHaveLength(50)
  })
})

describe('practice answers and daily limits', () => {
  it('are not counted', () => {
    expect(dailyCounters([log('a', NOW), log('b', NOW, { practice: true })])).toEqual({
      newIntroduced: 1,
      reviewsDone: 0,
    })
  })

  it('do not use up the review limit of the session', () => {
    const cards = Array.from({ length: 5 }, (_, i) => card(`c${i}`, 'd'))
    const queue = buildSession(
      {
        decks: [deck('d')],
        cards,
        states: cards.map((c) => review(c.id, NOW - 1)),
        logsToday: Array.from({ length: 5 }, (_, i) =>
          log(`p${i}`, NOW - 1000, { practice: true, state_before: { ...review('x', 0) } }),
        ),
        settings: { ...settings, max_reviews_per_day: 5 },
        extraNew: 0,
      },
      NOW,
    )
    expect(queue).toHaveLength(5)
  })
})
