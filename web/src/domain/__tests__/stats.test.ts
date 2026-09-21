import { describe, expect, it } from 'vitest'
import {
  buildStats,
  dueForecast,
  heatLevel,
  kpis,
  periodDays,
  retention,
  reviewsPerDay,
  stateDistribution,
  timePerDay,
} from '../stats'
import { card, deck, log, review, state } from './fixtures'

const DAY = 86_400_000
// 2026-09-21 12:00 in Riga (the test time zone).
const NOW = new Date(2026, 8, 21, 12).getTime()
const clock = { now: NOW, dayStartHour: 4 }

/** A log answered to a card in the Review state. */
const reviewLog = (card_id: string, at: number, extra: Parameters<typeof log>[2] = {}) => {
  const { card_id: _c, direction: _d, updated_at: _u, updated_by: _b, deleted_at: _x, ...before } = review(card_id, 0)
  return log(card_id, at, { state_before: before, ...extra })
}

describe('per-day series', () => {
  it('stacks answers by rating on their study days, without undone ones', () => {
    const days = periodDays(3, clock)
    expect(days).toEqual(['2026-09-19', '2026-09-20', '2026-09-21'])
    const logs = [
      log('c1', NOW, { rating: 1 }),
      log('c1', NOW - DAY, { rating: 3 }),
      log('c1', NOW - DAY, { rating: 4 }),
      log('c1', new Date(2026, 8, 21, 3, 30).getTime(), { rating: 2 }),
      log('c1', NOW, { rating: 3, deleted_at: NOW }),
    ]
    expect(reviewsPerDay(logs, days, clock)).toEqual([
      { day: '2026-09-19', again: 0, hard: 0, good: 0, easy: 0 },
      { day: '2026-09-20', again: 0, hard: 1, good: 1, easy: 1 },
      { day: '2026-09-21', again: 1, hard: 0, good: 0, easy: 0 },
    ])
  })

  it('sums the time per day in minutes', () => {
    const logs = [log('c1', NOW, { duration_ms: 60_000 }), log('c1', NOW, { duration_ms: 30_000 })]
    expect(timePerDay(logs, ['2026-09-21'], clock)).toEqual([{ day: '2026-09-21', minutes: 1.5 }])
  })
})

describe('retention', () => {
  it('counts Good and Easy of Review answers, without practice and other states', () => {
    const logs = [
      reviewLog('c1', NOW, { rating: 3 }),
      reviewLog('c2', NOW, { rating: 4 }),
      reviewLog('c3', NOW, { rating: 1 }),
      reviewLog('c4', NOW, { rating: 2 }),
      reviewLog('c5', NOW, { rating: 1, practice: true }),
      log('c6', NOW, { rating: 1 }),
    ]
    expect(retention(logs)).toBe(0.5)
    expect(retention([log('c6', NOW)])).toBeNull()
  })
})

describe('dueForecast', () => {
  it('counts overdue cards on today and leaves New cards out', () => {
    const forecast = dueForecast(
      [
        review('overdue', NOW - 5 * DAY),
        review('today', NOW + 3_600_000),
        review('tomorrow', NOW + DAY),
        review('late', NOW + 40 * DAY),
        state('new'),
        review('deleted', NOW, { deleted_at: 1 }),
      ],
      clock,
    )
    expect(forecast).toHaveLength(30)
    expect(forecast.slice(0, 2)).toEqual([
      { day: '2026-09-21', count: 2 },
      { day: '2026-09-22', count: 1 },
    ])
    expect(forecast.reduce((sum, day) => sum + day.count, 0)).toBe(3)
  })
})

describe('stateDistribution', () => {
  it('splits Review at 21 days and groups Learning with Relearning', () => {
    expect(
      stateDistribution([
        state('a'),
        state('b', { state: 1 }),
        state('c', { state: 3 }),
        review('d', NOW, { scheduled_days: 20 }),
        review('e', NOW, { scheduled_days: 21 }),
      ]),
    ).toEqual({ new: 1, learning: 2, young: 1, mature: 1 })
  })
})

describe('kpis and heatmap', () => {
  it('counts a card as mature when all its directions are', () => {
    const cards = [card('a', 'd1'), card('b', 'd1')]
    const states = [
      review('a', NOW, { scheduled_days: 30 }),
      review('a', NOW, { scheduled_days: 30, direction: 'reverse' }),
      review('b', NOW, { scheduled_days: 30 }),
      review('b', NOW, { scheduled_days: 5, direction: 'reverse' }),
    ]
    const logs = [log('a', NOW - DAY), log('a', NOW - 2 * DAY), log('a', NOW - 5 * DAY)]
    expect(kpis(cards, states, logs, clock)).toEqual({
      totalCards: 2,
      matureCards: 1,
      currentStreak: 2,
      longestStreak: 2,
    })
  })

  it('buckets the heatmap intensity', () => {
    expect([0, 1, 10, 11, 30, 31, 60, 61].map(heatLevel)).toEqual([0, 1, 1, 2, 2, 3, 3, 4])
  })
})

describe('buildStats', () => {
  const decks = [deck('d1'), deck('d2'), deck('gone', { deleted_at: 1 }), deck('old', { archived_at: 1 })]
  const cards = [
    card('a', 'd1'),
    card('b', 'd2'),
    card('c', 'gone'),
    card('d', 'old'),
    card('x', 'd1', { deleted_at: 1 }),
  ]
  const states = cards.map((c) => review(c.id, NOW + DAY))
  const logs = cards.map((c) => log(c.id, NOW))

  it('covers active decks; a deleted card keeps its history', () => {
    const stats = buildStats({ decks, cards, states, logs }, 7, null, clock)
    expect(stats.total).toBe(3)
    expect(stats.kpis.totalCards).toBe(2)
    expect(stats.states.young).toBe(2)
    expect(stats.forecast[1]?.count).toBe(2)
    expect(stats.kpis.currentStreak).toBe(1)
  })

  it('narrows everything but the streaks to one deck', () => {
    const stats = buildStats({ decks, cards, states, logs }, 7, 'd2', clock)
    expect(stats.total).toBe(1)
    expect(stats.kpis.totalCards).toBe(1)
    expect(stats.reviews.at(-1)).toMatchObject({ day: '2026-09-21', good: 1 })
    expect(stats.days).toHaveLength(7)
    expect(stats.year).toHaveLength(365)
    expect(buildStats({ decks, cards, states, logs }, 7, 'gone', clock).total).toBe(0)
  })
})
