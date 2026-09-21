import { beforeEach, describe, expect, it } from 'vitest'
import { resetDb } from '@/test/db'
import { resetProgress, saveCardState } from './cardStates'
import { addTag, createCard, deleteCards, listDeckCardsWithStates, moveCards, removeTag, undeleteCards } from './cards'
import { createDeck, type DeckInput } from './decks'
import { appendReview } from './reviewLog'
import { db } from './schema'

const deckInput: DeckInput = {
  name: 'English',
  target_lang: 'en-GB',
  native_lang: 'ru',
  directions: 'both',
  new_per_day: null,
}

beforeEach(resetDb)

describe('resetProgress', () => {
  it('sets states to New, keeps the review log and outboxes only the states', async () => {
    const deck = await createDeck(deckInput)
    const card = await createCard({ deck_id: deck.id, front: 'a', back: 'б' })
    const forward = await db.card_states.get([card.id, 'forward'])
    if (!forward) throw new Error('missing state')
    await saveCardState({ ...forward, state: 2, reps: 5, lapses: 1, stability: 12, due: 99, last_review: 50 })
    const review = await appendReview({
      card_id: card.id,
      direction: 'forward',
      rating: 3,
      mode: 'swipe',
      state_before: forward,
      reviewed_at: 50,
      duration_ms: 900,
    })
    await db.outbox.clear()

    await resetProgress([card.id])
    expect(await db.card_states.get([card.id, 'forward'])).toMatchObject({
      state: 0,
      reps: 0,
      lapses: 0,
      stability: 0,
      last_review: null,
    })
    expect(await db.review_log.get(review.id)).toMatchObject({ deleted_at: null, rating: 3 })
    const entities = new Set((await db.outbox.toArray()).map((entry) => entry.entity))
    expect([...entities]).toEqual(['card_states'])
  })
})

describe('moveCards', () => {
  it('moving into a both-directions deck creates the missing reverse states', async () => {
    const forward = await createDeck({ ...deckInput, directions: 'forward' })
    const both = await createDeck(deckInput)
    const a = await createCard({ deck_id: forward.id, front: 'a', back: 'a' })
    const b = await createCard({ deck_id: forward.id, front: 'b', back: 'b' })

    await moveCards([a.id, b.id], both.id)
    expect(await db.cards.get(a.id)).toMatchObject({ deck_id: both.id })
    expect(await db.card_states.get([b.id, 'reverse'])).toMatchObject({ state: 0 })
    expect((await listDeckCardsWithStates(both.id))?.map((item) => item.states.length)).toEqual([2, 2])
  })
})

describe('deleteCards', () => {
  it('soft-deletes cards with their states and undo restores them', async () => {
    const deck = await createDeck(deckInput)
    const a = await createCard({ deck_id: deck.id, front: 'a', back: 'a' })
    const deletedAt = await deleteCards([a.id])

    expect(await listDeckCardsWithStates(deck.id)).toEqual([])
    expect(
      (await db.card_states.where('card_id').equals(a.id).toArray()).every((s) => s.deleted_at === deletedAt),
    ).toBe(true)
    await undeleteCards([a.id], deletedAt)
    expect((await listDeckCardsWithStates(deck.id))?.[0]?.states).toHaveLength(2)
  })
})

describe('tags', () => {
  it('adds and removes a tag on several cards', async () => {
    const deck = await createDeck(deckInput)
    const a = await createCard({ deck_id: deck.id, front: 'a', back: 'a', tags: ['verbs'] })
    const b = await createCard({ deck_id: deck.id, front: 'b', back: 'b' })

    await addTag([a.id, b.id], ' verbs ')
    expect((await db.cards.get(b.id))?.tags).toEqual(['verbs'])
    expect((await db.cards.get(a.id))?.tags).toEqual(['verbs'])

    await removeTag([a.id, b.id], 'verbs')
    expect((await db.cards.get(a.id))?.tags).toEqual([])
  })
})
