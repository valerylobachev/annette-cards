import { beforeEach, describe, expect, it } from 'vitest'
import type { ImportCard } from '@/domain/import/validate'
import { resetDb } from '@/test/db'
import { saveCardState } from './cardStates'
import { createCard, listCards } from './cards'
import { createDeck, type DeckInput } from './decks'
import { importRows } from './importCards'
import { db } from './schema'

const deckInput: DeckInput = {
  name: 'English',
  target_lang: 'en-GB',
  native_lang: 'ru',
  directions: 'both',
  new_per_day: null,
}

beforeEach(resetDb)

describe('importRows', () => {
  it('inserts 1 200 rows in 3 batches with states and outbox entries', async () => {
    const deck = await createDeck(deckInput)
    await db.outbox.clear()
    const rows: ImportCard[] = Array.from({ length: 1200 }, (_, i) => ({ front: `word ${i}`, back: `слово ${i}` }))
    const progress: number[] = []

    const counts = await importRows(deck.id, rows, 'skip', (share) => progress.push(share))

    expect(counts).toEqual({ inserted: 1200, updated: 0, skipped: 0 })
    expect(progress).toEqual([500 / 1200, 1000 / 1200, 1])
    const cards = await listCards(deck.id)
    expect(cards).toHaveLength(1200)
    expect(await db.card_states.count()).toBe(2400)
    const outbox = await db.outbox.toArray()
    expect(outbox.filter((entry) => entry.entity === 'cards')).toHaveLength(1200)
    expect(outbox.filter((entry) => entry.entity === 'card_states')).toHaveLength(2400)
    expect(cards.every((card) => card.updated_by !== '' && card.updated_at > 0)).toBe(true)
  })

  it('skip leaves the existing card unchanged', async () => {
    const deck = await createDeck(deckInput)
    const existing = await createCard({ deck_id: deck.id, front: 'Cat', back: 'кошка' })

    const counts = await importRows(deck.id, [{ front: ' cat', back: 'кот' }], 'skip')

    expect(counts).toEqual({ inserted: 0, updated: 0, skipped: 1 })
    expect(await db.cards.get(existing.id)).toEqual(existing)
  })

  it('update changes the back but keeps the states and unfilled fields', async () => {
    const deck = await createDeck(deckInput)
    const existing = await createCard({ deck_id: deck.id, front: 'cat', back: 'кошка', example: 'A cat.' })
    const state = await db.card_states.get([existing.id, 'forward'])
    if (!state) throw new Error('missing state')
    await saveCardState({ ...state, state: 2, reps: 3 })

    const counts = await importRows(deck.id, [{ front: 'cat', back: 'кот', example: null }], 'update')

    expect(counts).toEqual({ inserted: 0, updated: 1, skipped: 0 })
    expect(await db.cards.get(existing.id)).toMatchObject({ back: 'кот', example: 'A cat.' })
    expect(await db.card_states.get([existing.id, 'forward'])).toMatchObject({ state: 2, reps: 3 })
    expect(await listCards(deck.id)).toHaveLength(1)
  })

  it('import_anyway adds a second card with the same front', async () => {
    const deck = await createDeck(deckInput)
    await createCard({ deck_id: deck.id, front: 'cat', back: 'кошка' })

    const counts = await importRows(deck.id, [{ front: 'cat', back: 'кот' }], 'import_anyway')

    expect(counts).toEqual({ inserted: 1, updated: 0, skipped: 0 })
    expect(await listCards(deck.id)).toHaveLength(2)
  })

  it('treats a repeated front within the file like an existing card', async () => {
    const deck = await createDeck(deckInput)
    const rows: ImportCard[] = [
      { front: 'cat', back: 'кошка' },
      { front: 'Cat', back: 'кот' },
    ]

    expect(await importRows(deck.id, rows, 'skip')).toEqual({ inserted: 1, updated: 0, skipped: 1 })
    const [card] = await listCards(deck.id)
    expect(card?.back).toBe('кошка')
  })
})
