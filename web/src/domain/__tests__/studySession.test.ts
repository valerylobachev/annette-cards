import { describe, expect, it } from 'vitest'
import { answerRatings, swipeOutcome, swipeRating } from '../rating'
import type { QueueItem } from '../session'
import {
  applyAnswer,
  applyUndo,
  canResume,
  newSnapshot,
  RESUME_WITHIN_MS,
  sessionProgress,
  skipCurrent,
} from '../studySession'

const NOW = new Date(2026, 8, 21, 12, 0).getTime()
const MINUTE = 60_000
const size = { width: 400, height: 600 }
const still = { x: 0, y: 0 }

describe('swipe rating', () => {
  it('maps left to Again and right to Good in both modes, up to Easy only in detailed mode', () => {
    expect(swipeRating('left', 'simple')).toBe(1)
    expect(swipeRating('right', 'simple')).toBe(3)
    expect(swipeRating('up', 'simple')).toBeNull()
    expect(swipeRating('left', 'detailed')).toBe(1)
    expect(swipeRating('right', 'detailed')).toBe(3)
    expect(swipeRating('up', 'detailed')).toBe(4)
  })

  it('shows ✗ / ✓ in simple mode and four buttons in detailed mode', () => {
    expect(answerRatings('simple')).toEqual([1, 3])
    expect(answerRatings('detailed')).toEqual([1, 2, 3, 4])
  })

  it('commits beyond 35 % of the width, otherwise springs back', () => {
    expect(swipeOutcome({ x: 141, y: 0 }, still, size, 'simple')).toBe('right')
    expect(swipeOutcome({ x: -141, y: 0 }, still, size, 'simple')).toBe('left')
    expect(swipeOutcome({ x: 139, y: 0 }, still, size, 'simple')).toBeNull()
  })

  it('commits a short fast fling in its direction', () => {
    expect(swipeOutcome({ x: 30, y: 0 }, { x: 700, y: 0 }, size, 'simple')).toBe('right')
    expect(swipeOutcome({ x: 30, y: 0 }, { x: -700, y: 0 }, size, 'simple')).toBeNull()
  })

  it('commits swipe up beyond 30 % of the height in detailed mode only', () => {
    expect(swipeOutcome({ x: 10, y: -181 }, still, size, 'detailed')).toBe('up')
    expect(swipeOutcome({ x: 10, y: -179 }, still, size, 'detailed')).toBeNull()
    expect(swipeOutcome({ x: 10, y: -30 }, { x: 0, y: -700 }, size, 'detailed')).toBe('up')
    expect(swipeOutcome({ x: 10, y: -300 }, still, size, 'simple')).toBeNull()
  })
})

const item = (card_id: string, kind: QueueItem['kind'] = 'new'): QueueItem => ({
  card_id,
  direction: 'forward',
  kind,
})
const params = { deck: 'd', practice: false, repeat: null }

describe('study session snapshot', () => {
  const fresh = newSnapshot('s', params, [item('a'), item('b', 'review'), item('c')], NOW)

  it('resumes after 29 minutes and rebuilds after 31', () => {
    const saved = { ...fresh, last_active_at: NOW }
    expect(canResume(saved, params, NOW + 29 * MINUTE)).toBe(true)
    expect(canResume(saved, params, NOW + 31 * MINUTE)).toBe(false)
    expect(canResume(saved, params, NOW + RESUME_WITHIN_MS)).toBe(false)
  })

  it('does not resume another deck, another mode or a finished session', () => {
    expect(canResume(fresh, { ...params, deck: null }, NOW)).toBe(false)
    expect(canResume(fresh, { ...params, practice: true }, NOW)).toBe(false)
    expect(canResume(fresh, { ...params, repeat: 'other' }, NOW)).toBe(false)
    expect(canResume({ ...fresh, finished_at: NOW }, params, NOW)).toBe(false)
    expect(canResume(null, params, NOW)).toBe(false)
  })

  it('moves to the next card after an answer and counts progress', () => {
    const next = applyAnswer(fresh, { log_id: 'l1', nextDue: NOW + 86_400_000, reinsert: false }, NOW + 5000)
    expect(next.queue.map((i) => i.card_id)).toEqual(['b', 'c'])
    expect(next.last_active_at).toBe(NOW + 5000)
    expect(sessionProgress(next)).toEqual({ done: 1, total: 3, counts: { new: 1, learning: 0, review: 1 } })
  })

  it('puts a learning step back into the queue as a learning card', () => {
    const next = applyAnswer(fresh, { log_id: 'l1', nextDue: NOW + MINUTE, reinsert: true }, NOW)
    expect(next.queue).toEqual([item('b', 'review'), item('c'), item('a', 'learning')])
    expect(sessionProgress(next)).toMatchObject({ done: 1, total: 4 })
  })

  it('undo restores the queue with the card on top, once', () => {
    const answered = applyAnswer(fresh, { log_id: 'l1', nextDue: NOW + MINUTE, reinsert: true }, NOW)
    const undone = applyUndo(answered, NOW + 1)
    expect(undone.queue).toEqual(fresh.queue)
    expect(undone.log_ids).toEqual([])
    expect(undone.undo).toBeNull()
    expect(applyUndo(undone, NOW + 2)).toBe(undone)
  })

  it('finishes when the last card is answered or skipped', () => {
    const one = newSnapshot('s', params, [item('a')], NOW)
    expect(applyAnswer(one, { log_id: 'l', nextDue: NOW + 86_400_000, reinsert: false }, NOW).finished_at).toBe(NOW)
    expect(skipCurrent(one, NOW).finished_at).toBe(NOW)
    expect(applyUndo(applyAnswer(one, { log_id: 'l', nextDue: 0, reinsert: false }, NOW), NOW).finished_at).toBeNull()
  })
})
