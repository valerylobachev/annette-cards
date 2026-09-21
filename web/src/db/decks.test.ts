import { beforeEach, describe, expect, it } from 'vitest'
import { setClock } from '@/lib/clock'
import { resetDb } from '@/test/db'
import { createCard, deleteCard } from './cards'
import { createDeck, type DeckInput, deleteDeck, listDeckSummaries, undeleteDeck, updateDeck } from './decks'
import { cardStateEntityId } from './outbox'
import { db } from './schema'

const deckInput: DeckInput = {
  name: 'English',
  target_lang: 'en-GB',
  native_lang: 'ru',
  directions: 'both',
  new_per_day: null,
}

function cardInput(deck_id: string, front: string) {
  return {
    deck_id,
    front,
    back: `${front}-ru`,
    example: null,
    example_translation: null,
    ipa: null,
    tags: [],
    notes: null,
  }
}

beforeEach(resetDb)

describe('card states per direction', () => {
  it('keeps disabled-direction states and never duplicates them', async () => {
    const deck = await createDeck(deckInput)
    const card = await createCard(cardInput(deck.id, 'take off'))
    expect(await db.card_states.where('card_id').equals(card.id).count()).toBe(2)

    await updateDeck(deck.id, { directions: 'forward' })
    const states = await db.card_states.where('card_id').equals(card.id).toArray()
    expect(states.map((state) => [state.direction, state.deleted_at])).toEqual([
      ['forward', null],
      ['reverse', null],
    ])

    await updateDeck(deck.id, { directions: 'both' })
    expect(await db.card_states.where('card_id').equals(card.id).count()).toBe(2)
  })

  it('adds states for a newly enabled direction to every card', async () => {
    const deck = await createDeck({ ...deckInput, directions: 'forward' })
    const cards = [await createCard(cardInput(deck.id, 'a')), await createCard(cardInput(deck.id, 'b'))]
    expect(await db.card_states.count()).toBe(2)

    await updateDeck(deck.id, { directions: 'both' })
    for (const card of cards) {
      expect(await db.card_states.get([card.id, 'reverse'])).toMatchObject({ state: 0 })
    }
    const stateEntries = await db.outbox.where({ entity: 'card_states' }).toArray()
    expect(stateEntries).toHaveLength(4)
  })
})

describe('deleteDeck', () => {
  it('soft-deletes deck, cards and states in one change and undeleteDeck restores exactly them', async () => {
    setClock(() => 1_000)
    const deck = await createDeck(deckInput)
    const kept = await createCard(cardInput(deck.id, 'a'))
    const deletedEarlier = await createCard(cardInput(deck.id, 'b'))
    setClock(() => 2_000)
    await deleteCard(deletedEarlier.id)
    await db.outbox.clear()

    setClock(() => 3_000)
    await deleteDeck(deck.id)
    expect(await db.decks.get(deck.id)).toMatchObject({ deleted_at: 3_000 })
    expect(await db.cards.get(kept.id)).toMatchObject({ deleted_at: 3_000 })
    expect(await db.card_states.where('card_id').equals(kept.id).toArray()).toEqual([
      expect.objectContaining({ deleted_at: 3_000 }),
      expect.objectContaining({ deleted_at: 3_000 }),
    ])
    const outbox = (await db.outbox.toArray()).map((entry) => `${entry.entity}/${entry.entity_id}`).sort()
    expect(outbox).toEqual(
      [
        `decks/${deck.id}`,
        `cards/${kept.id}`,
        `card_states/${cardStateEntityId(kept.id, 'forward')}`,
        `card_states/${cardStateEntityId(kept.id, 'reverse')}`,
      ].sort(),
    )

    setClock(() => 4_000)
    await undeleteDeck(deck.id)
    expect(await db.decks.get(deck.id)).toMatchObject({ deleted_at: null, updated_at: 4_000 })
    expect(await db.cards.get(kept.id)).toMatchObject({ deleted_at: null, updated_at: 4_000 })
    expect(await db.cards.get(deletedEarlier.id)).toMatchObject({ deleted_at: 2_000 })
    const states = await db.card_states.where('card_id').equals(kept.id).toArray()
    expect(states.every((state) => state.deleted_at === null && state.updated_at === 4_000)).toBe(true)
  })
})

describe('listDeckSummaries', () => {
  it('counts cards and new states per deck', async () => {
    const deck = await createDeck(deckInput)
    await createCard(cardInput(deck.id, 'a'))
    const [row] = await listDeckSummaries()
    expect(row?.summary).toMatchObject({ cards: 1, new: 2, due: 0 })
  })
})
