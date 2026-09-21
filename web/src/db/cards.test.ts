import { beforeEach, describe, expect, it } from 'vitest'
import { ValidationError } from '@/domain/validation'
import { resetDb } from '@/test/db'
import { createCard, deleteCard, findDuplicate, listTags, updateCard } from './cards'
import { createDeck, type DeckInput } from './decks'
import { cardStateEntityId } from './outbox'
import { db } from './schema'

const deckInput: DeckInput = {
  name: 'English',
  target_lang: 'en-GB',
  native_lang: 'ru',
  directions: 'both',
  new_per_day: null,
}

beforeEach(resetDb)

describe('createCard', () => {
  it('creates two New states in a both-directions deck with outbox entries for card and states', async () => {
    const deck = await createDeck(deckInput)
    await db.outbox.clear()
    const card = await createCard({ deck_id: deck.id, front: ' take off ', back: 'взлетать', tags: ['verbs'] })

    expect(card).toMatchObject({ front: 'take off', example: null, tags: ['verbs'] })
    const states = await db.card_states.where('card_id').equals(card.id).toArray()
    expect(states.map((state) => [state.direction, state.state])).toEqual([
      ['forward', 0],
      ['reverse', 0],
    ])
    const outbox = (await db.outbox.toArray()).map((entry) => `${entry.entity}/${entry.entity_id}`)
    expect(outbox.sort()).toEqual(
      [
        `cards/${card.id}`,
        `card_states/${cardStateEntityId(card.id, 'forward')}`,
        `card_states/${cardStateEntityId(card.id, 'reverse')}`,
      ].sort(),
    )
  })

  it('rejects invalid input without writing anything', async () => {
    const deck = await createDeck(deckInput)
    await expect(createCard({ deck_id: deck.id, front: '', back: 'x' })).rejects.toBeInstanceOf(ValidationError)
    expect(await db.cards.count()).toBe(0)
    expect(await db.card_states.count()).toBe(0)
  })
})

describe('updateCard', () => {
  it('moving a card from a forward deck to a both deck adds the reverse state', async () => {
    const forward = await createDeck({ ...deckInput, directions: 'forward' })
    const both = await createDeck(deckInput)
    const card = await createCard({ deck_id: forward.id, front: 'a', back: 'б' })
    expect(await db.card_states.where('card_id').equals(card.id).count()).toBe(1)

    await updateCard(card.id, { deck_id: both.id })
    expect(await db.card_states.get([card.id, 'reverse'])).toMatchObject({ state: 0 })
    expect(await db.card_states.where('card_id').equals(card.id).count()).toBe(2)
  })
})

describe('findDuplicate', () => {
  it('matches the normalized front in the same deck only, ignoring deleted cards', async () => {
    const deck = await createDeck(deckInput)
    const other = await createDeck({ ...deckInput, name: 'Other' })
    const existing = await createCard({ deck_id: deck.id, front: 'take off', back: 'взлетать' })

    expect((await findDuplicate(deck.id, '  Take  off '))?.id).toBe(existing.id)
    expect(await findDuplicate(other.id, 'Take off')).toBeUndefined()
    expect(await findDuplicate(deck.id, 'Take off', existing.id)).toBeUndefined()

    await deleteCard(existing.id)
    expect(await findDuplicate(deck.id, 'Take off')).toBeUndefined()
  })
})

describe('listTags', () => {
  it('returns distinct sorted tags of non-deleted cards', async () => {
    const deck = await createDeck(deckInput)
    await createCard({ deck_id: deck.id, front: 'a', back: 'a', tags: ['verbs', 'b2'] })
    await createCard({ deck_id: deck.id, front: 'b', back: 'b', tags: ['verbs'] })
    const deleted = await createCard({ deck_id: deck.id, front: 'c', back: 'c', tags: ['old'] })
    await deleteCard(deleted.id)
    expect(await listTags()).toEqual(['b2', 'verbs'])
  })
})
