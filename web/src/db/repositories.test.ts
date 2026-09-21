import { beforeEach, describe, expect, it } from 'vitest'
import type { CardStateSnapshot } from '@/domain/types'
import { ValidationError } from '@/domain/validation'
import { setClock } from '@/lib/clock'
import { resetDb } from '@/test/db'
import { createCard, updateCard } from './cards'
import { createDeck, type DeckInput, deleteDeck, getDeck, listDecks } from './decks'
import { getDeviceId } from './device'
import { setMeta } from './meta'
import * as reviewLog from './reviewLog'
import { appendReview, listReviews, softDeleteReview } from './reviewLog'
import { db } from './schema'

const deckInput: DeckInput = {
  name: 'English B2',
  target_lang: 'en-GB',
  native_lang: 'ru',
  directions: 'both',
  new_per_day: null,
}

const newState: CardStateSnapshot = {
  state: 0,
  due: 0,
  stability: 0,
  difficulty: 0,
  elapsed_days: 0,
  scheduled_days: 0,
  learning_steps: 0,
  reps: 0,
  lapses: 0,
  last_review: null,
}

beforeEach(resetDb)

describe('decks repository', () => {
  it('stamps a new deck and writes exactly one outbox entry', async () => {
    setClock(() => 1_000)
    const deck = await createDeck(deckInput)

    expect(deck).toMatchObject({ updated_at: 1_000, created_at: 1_000, updated_by: await getDeviceId() })
    expect(await db.decks.get(deck.id)).toEqual(deck)
    expect(await db.outbox.toArray()).toEqual([{ seq: expect.any(Number), entity: 'decks', entity_id: deck.id }])
  })

  it('soft delete keeps the row but hides it from get and list', async () => {
    const deck = await createDeck(deckInput)
    setClock(() => 5_000)
    await deleteDeck(deck.id)

    expect(await listDecks()).toEqual([])
    expect(await getDeck(deck.id)).toBeUndefined()
    expect(await db.decks.get(deck.id)).toMatchObject({ deleted_at: 5_000, updated_at: 5_000 })
  })

  it('rolls back the entity and the outbox when validation fails', async () => {
    await expect(createDeck({ ...deckInput, name: '   ' })).rejects.toBeInstanceOf(ValidationError)
    expect(await db.decks.count()).toBe(0)
    expect(await db.outbox.count()).toBe(0)
  })
})

describe('cards repository', () => {
  it('updating a card three times leaves one outbox entry and the latest updated_at', async () => {
    const deck = await createDeck(deckInput)
    const card = await createCard({
      deck_id: deck.id,
      front: 'take off',
      back: 'взлетать',
      example: null,
      example_translation: null,
      ipa: null,
      tags: [],
      notes: null,
    })
    for (const [i, back] of ['снимать', 'взлёт', 'уходить'].entries()) {
      setClock(() => 10_000 + i)
      await updateCard(card.id, { back })
    }

    expect(await db.cards.get(card.id)).toMatchObject({ back: 'уходить', updated_at: 10_002 })
    const cardEntries = await db.outbox.where({ entity: 'cards' }).toArray()
    expect(cardEntries.map((entry) => entry.entity_id)).toEqual([card.id])
    // The last change moved the entry to the end of the outbox.
    expect((await db.outbox.orderBy('seq').last())?.entity_id).toBe(card.id)
  })
})

describe('review log repository', () => {
  it('only supports append and soft delete', async () => {
    const entry = await appendReview({
      card_id: 'c1',
      direction: 'forward',
      rating: 3,
      mode: 'swipe',
      state_before: newState,
      reviewed_at: 1,
      duration_ms: 1200,
    })
    expect(Object.keys(reviewLog).filter((name) => /update|put|edit/i.test(name))).toEqual([])

    await softDeleteReview(entry.id)
    expect(await listReviews('c1')).toEqual([])
    const stored = await db.review_log.get(entry.id)
    expect(stored).toMatchObject({ rating: 3, deleted_at: expect.any(Number) })
  })
})

describe('meta', () => {
  it('writes do not touch the outbox', async () => {
    await setMeta('theme', 'dark')
    await setMeta('voice_pref', { 'en-GB': 'Daniel' })
    expect(await db.outbox.count()).toBe(0)
  })
})
