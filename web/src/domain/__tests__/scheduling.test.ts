import { describe, expect, it } from 'vitest'
import { dailyCounters } from '../counters'
import { createScheduler, fromFsrsCard, nextState, snapshotOf, toFsrsCard } from '../fsrs'
import { DEFAULT_SETTINGS } from '../settings'
import { studyDayBounds, studyDayOf } from '../studyDay'
import { log, review, state } from './fixtures'

const MINUTE = 60_000

describe('FSRS wrapper', () => {
  const scheduler = createScheduler(DEFAULT_SETTINGS)
  const start = new Date(2026, 8, 21, 12, 0).getTime()

  it('moves a New card rated Good twice to Review with a due date in the future', () => {
    const first = nextState(scheduler, state('c', { due: start }), 3, start)
    expect(first.state.state).toBe(1)
    expect(first.state.due - start).toBeLessThan(20 * MINUTE)

    const later = first.state.due
    const second = nextState(scheduler, first.state, 3, later)
    expect(second.state.state).toBe(2)
    expect(second.state.due).toBeGreaterThan(later + 12 * 3_600_000)
    expect(second.state).toMatchObject({ card_id: 'c', direction: 'forward', reps: 2, last_review: later })
  })

  it('moves a Review card rated Again to Relearning and counts a lapse', () => {
    const due = start - MINUTE
    const { state: next } = nextState(scheduler, review('c', due, { lapses: 1 }), 1, start)
    expect(next.state).toBe(3)
    expect(next.lapses).toBe(2)
    expect(next.due - start).toBeLessThan(20 * MINUTE)
  })

  it('converts states to ts-fsrs cards and back without loss', () => {
    const original = snapshotOf(review('c', start, { last_review: start - 5 * 86_400_000, scheduled_days: 5 }))
    expect(fromFsrsCard(toFsrsCard(original))).toEqual(original)
    const fresh = snapshotOf(state('c', { due: start }))
    expect(fromFsrsCard(toFsrsCard(fresh))).toEqual(fresh)
  })

  it('uses custom weights and the desired retention', () => {
    const custom = createScheduler({ desired_retention: 0.8, fsrs_weights: null })
    expect(custom.parameters.request_retention).toBe(0.8)
    expect(custom.parameters.enable_fuzz).toBe(true)
    expect(custom.parameters.maximum_interval).toBe(36500)
  })
})

describe('study day', () => {
  // The test setup fixes TZ = Europe/Riga (UTC+2 in winter, UTC+3 in summer).
  it('counts a review at 03:59 for the previous day when the day starts at 04:00', () => {
    expect(studyDayOf(new Date(2026, 8, 21, 3, 59).getTime(), 4)).toBe('2026-09-20')
    expect(studyDayOf(new Date(2026, 8, 21, 4, 0).getTime(), 4)).toBe('2026-09-21')
    expect(studyDayOf(new Date(2026, 8, 21, 0, 30).getTime(), 0)).toBe('2026-09-21')
    expect(studyDayOf(new Date(2026, 8, 20, 23, 59).getTime(), 0)).toBe('2026-09-20')
  })

  it('keeps the local boundary across DST changes', () => {
    // 2026-03-29: clocks go from 03:00 to 04:00. 2026-10-25: from 04:00 back to 03:00.
    expect(studyDayOf(new Date(2026, 2, 29, 4, 30).getTime(), 4)).toBe('2026-03-29')
    expect(studyDayOf(new Date(2026, 2, 29, 2, 30).getTime(), 4)).toBe('2026-03-28')

    const [springStart, springEnd] = studyDayBounds('2026-03-28', 4)
    expect(springEnd - springStart).toBe(23 * 3_600_000)
    const [autumnStart, autumnEnd] = studyDayBounds('2026-10-25', 4)
    expect(autumnEnd - autumnStart).toBe(24 * 3_600_000)
    const [fallStart, fallEnd] = studyDayBounds('2026-10-24', 4)
    expect(fallEnd - fallStart).toBe(25 * 3_600_000)
    expect(new Date(fallStart).getHours()).toBe(4)
    expect(new Date(fallEnd).getHours()).toBe(4)
  })

  it('returns bounds that contain exactly the moments of that day', () => {
    const [start, end] = studyDayBounds('2026-09-21', 4)
    expect(studyDayOf(start, 4)).toBe('2026-09-21')
    expect(studyDayOf(end - 1, 4)).toBe('2026-09-21')
    expect(studyDayOf(end, 4)).toBe('2026-09-22')
  })
})

describe('dailyCounters', () => {
  it('counts answers to New cards as introduced and the rest as reviews, ignoring undone answers', () => {
    const counters = dailyCounters([
      log('a', 1),
      log('b', 2),
      log('c', 3, { state_before: snapshotOf(review('c', 0)) }),
      log('d', 4, { deleted_at: 5 }),
    ])
    expect(counters).toEqual({ newIntroduced: 2, reviewsDone: 1 })
  })
})
