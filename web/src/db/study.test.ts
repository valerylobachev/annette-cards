import { beforeEach, describe, expect, it } from 'vitest'
import { dailyCounters } from '@/domain/counters'
import { setClock } from '@/lib/clock'
import { resetDb } from '@/test/db'
import { saveCardState } from './cardStates'
import { createCard } from './cards'
import { createDeck } from './decks'
import { db } from './schema'
import { answer, StudyError, undoAnswer } from './study'

const DAY = 86_400_000
const T0 = new Date(2026, 8, 21, 12, 0).getTime()

beforeEach(async () => {
  await resetDb()
  setClock(() => T0)
})

async function newCard() {
  const deck = await createDeck({
    name: 'English',
    target_lang: 'en-GB',
    native_lang: 'ru',
    directions: 'forward',
    new_per_day: null,
  })
  const card = await createCard({ deck_id: deck.id, front: 'cat', back: 'кошка' })
  await db.outbox.clear()
  return card
}

async function forwardState(card_id: string) {
  const state = await db.card_states.get([card_id, 'forward'])
  if (!state) throw new Error('missing state')
  return state
}

const good = { direction: 'forward', rating: 3, mode: 'swipe', duration_ms: 1200 } as const

describe('answer', () => {
  it('rates a New card Good: new state, one log with state_before New, outbox entries for both', async () => {
    const card = await newCard()

    const result = await answer({ ...good, card_id: card.id })

    const state = await forwardState(card.id)
    expect(state).toMatchObject({ state: 1, reps: 1, last_review: T0, updated_at: T0 })
    expect(result.nextState).toEqual(state)
    expect(result.reinsert).toBe(true)
    const logs = await db.review_log.toArray()
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({
      id: result.log_id,
      state_before: { state: 0, reps: 0 },
      reviewed_at: T0,
      rating: 3,
      practice: false,
    })
    expect(logs[0]?.state_before).not.toHaveProperty('card_id')
    const outbox = await db.outbox.toArray()
    expect(outbox.map((entry) => entry.entity).sort()).toEqual(['card_states', 'review_log'])
  })

  it('leaves the state and the log untouched when the transaction fails', async () => {
    const card = await newCard()
    const before = await forwardState(card.id)
    const fail = () => {
      throw new Error('disk full')
    }
    db.review_log.hook('creating', fail)
    try {
      await expect(answer({ ...good, card_id: card.id })).rejects.toThrow('disk full')
    } finally {
      db.review_log.hook('creating').unsubscribe(fail)
    }
    expect(await forwardState(card.id)).toEqual(before)
    expect(await db.review_log.count()).toBe(0)
    expect(await db.outbox.count()).toBe(0)
  })

  it('rates a Review card Again: Relearning, one more lapse, reinsert', async () => {
    const card = await newCard()
    const state = await forwardState(card.id)
    await saveCardState({
      ...state,
      state: 2,
      due: T0 - DAY,
      stability: 12,
      difficulty: 5,
      reps: 4,
      lapses: 1,
      scheduled_days: 10,
      last_review: T0 - 11 * DAY,
    })

    const result = await answer({ ...good, card_id: card.id, rating: 1 })

    expect(result.nextState).toMatchObject({ state: 3, lapses: 2 })
    expect(result.reinsert).toBe(true)
  })

  it('rejects an answer for a missing state', async () => {
    await expect(answer({ ...good, card_id: 'nope' })).rejects.toEqual(new StudyError('state_not_found'))
  })
})

describe('undoAnswer', () => {
  it('restores the snapshot, soft-deletes the log and lowers the counters', async () => {
    const card = await newCard()
    const before = await forwardState(card.id)
    const { log_id } = await answer({ ...good, card_id: card.id })
    expect(dailyCounters(await db.review_log.toArray())).toEqual({ newIntroduced: 1, reviewsDone: 0 })
    await db.outbox.clear()

    setClock(() => T0 + 5000)
    await undoAnswer(log_id)

    const { updated_at, updated_by, ...restored } = await forwardState(card.id)
    const { updated_at: _at, updated_by: _by, ...expected } = before
    expect(restored).toEqual(expected)
    expect(updated_at).toBe(T0 + 5000)
    expect(await db.review_log.get(log_id)).toMatchObject({ deleted_at: T0 + 5000, updated_at: T0 + 5000 })
    expect(dailyCounters(await db.review_log.toArray())).toEqual({ newIntroduced: 0, reviewsDone: 0 })
    expect((await db.outbox.toArray()).map((entry) => entry.entity).sort()).toEqual(['card_states', 'review_log'])
  })

  it('refuses to undo an answer that is not the last one', async () => {
    const card = await newCard()
    const first = await answer({ ...good, card_id: card.id })
    setClock(() => T0 + 60_000)
    const second = await answer({ ...good, card_id: card.id })

    await expect(undoAnswer(first.log_id)).rejects.toEqual(new StudyError('undo_not_last'))
    await undoAnswer(second.log_id)
    // One level only: the earlier answer is now the latest, but a second undo of the same answer fails.
    await expect(undoAnswer(second.log_id)).rejects.toEqual(new StudyError('log_not_found'))
  })
})

describe('practice answers', () => {
  it('keep the state of a card due tomorrow and are logged with practice: true', async () => {
    const card = await newCard()
    const state = await forwardState(card.id)
    const reviewState = { ...state, state: 2 as const, due: T0 + DAY, stability: 1.5, reps: 3, last_review: T0 - DAY }
    await saveCardState(reviewState)
    const before = await forwardState(card.id)
    await db.outbox.clear()

    const result = await answer({ ...good, card_id: card.id, rating: 1, practice: true })

    expect(await forwardState(card.id)).toEqual(before)
    expect(result.reinsert).toBe(false)
    expect(await db.review_log.get(result.log_id)).toMatchObject({ practice: true, rating: 1 })
    expect((await db.outbox.toArray()).map((entry) => entry.entity)).toEqual(['review_log'])
    expect(dailyCounters(await db.review_log.toArray())).toEqual({ newIntroduced: 0, reviewsDone: 0 })
  })

  it('schedule an overdue card normally', async () => {
    const card = await newCard()
    const state = await forwardState(card.id)
    await saveCardState({
      ...state,
      state: 2,
      due: T0 - DAY,
      stability: 5,
      difficulty: 5,
      reps: 3,
      last_review: T0 - 6 * DAY,
    })

    const result = await answer({ ...good, card_id: card.id, practice: true })

    expect(result.nextState.due).toBeGreaterThan(T0 + DAY)
    expect((await forwardState(card.id)).reps).toBe(4)
  })
})
