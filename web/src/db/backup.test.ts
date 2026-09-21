import { beforeEach, describe, expect, it } from 'vitest'
import { parseBackup } from '@/domain/backup/format'
import { resetDb } from '@/test/db'
import { exportAll, exportDeckCsv, restoreAsNew, restoreReplace } from './backup'
import { saveCardState } from './cardStates'
import { createCard } from './cards'
import { createDeck, type DeckInput, listDecks } from './decks'
import { appendReview } from './reviewLog'
import { db } from './schema'
import { getSettings, updateSettings } from './settings'

const deckInput: DeckInput = {
  name: 'English',
  target_lang: 'en-GB',
  native_lang: 'ru',
  directions: 'both',
  new_per_day: null,
}

beforeEach(resetDb)

async function seedDeck(name = 'English') {
  const deck = await createDeck({ ...deckInput, name })
  const cat = await createCard({ deck_id: deck.id, front: 'cat', back: 'кошка', tags: ['animals'] })
  await createCard({ deck_id: deck.id, front: 'dog', back: 'собака' })
  const state = await db.card_states.get([cat.id, 'forward'])
  if (!state) throw new Error('missing state')
  await saveCardState({ ...state, state: 2, reps: 4, stability: 10 })
  const { card_id: _c, direction: _d, updated_at: _u, updated_by: _b, deleted_at: _x, ...snapshot } = state
  await appendReview({
    card_id: cat.id,
    direction: 'forward',
    rating: 3,
    mode: 'swipe',
    state_before: snapshot,
    reviewed_at: 5,
    duration_ms: 800,
  })
  return { deck, cat }
}

describe('exportAll', () => {
  it('exports only non-deleted rows as a valid V1 backup', async () => {
    await seedDeck()
    const gone = await createDeck({ ...deckInput, name: 'Gone' })
    await db.decks.update(gone.id, { deleted_at: 1 })

    const backup = await exportAll()

    expect(parseBackup(JSON.parse(JSON.stringify(backup)))).toMatchObject({ ok: true })
    expect(backup.decks.map((deck) => deck.name)).toEqual(['English'])
    expect(backup.cards).toHaveLength(2)
    expect(backup.card_states).toHaveLength(4)
    expect(backup.review_log).toHaveLength(1)
  })
})

describe('restoreAsNew', () => {
  it('doubles the decks with new ids and keeps progress', async () => {
    const { cat } = await seedDeck()
    const backup = await exportAll()
    await db.outbox.clear()

    await restoreAsNew(backup)

    const decks = await listDecks()
    expect(decks).toHaveLength(2)
    expect(new Set(decks.map((deck) => deck.id)).size).toBe(2)
    const copies = await db.cards.filter((card) => card.front === 'cat').toArray()
    expect(copies).toHaveLength(2)
    const copy = copies.find((card) => card.id !== cat.id)
    expect(await db.card_states.get([copy?.id ?? '', 'forward'])).toMatchObject({ state: 2, reps: 4 })
    expect(
      await db.review_log
        .where('card_id')
        .equals(copy?.id ?? '')
        .count(),
    ).toBe(1)
    const outbox = await db.outbox.toArray()
    expect(outbox.filter((entry) => entry.entity === 'decks')).toHaveLength(1)
    expect(outbox.filter((entry) => entry.entity === 'cards')).toHaveLength(2)
    expect(outbox.filter((entry) => entry.entity === 'card_states')).toHaveLength(4)
    expect(outbox.filter((entry) => entry.entity === 'review_log')).toHaveLength(1)
  })
})

describe('restoreReplace', () => {
  it('leaves only the backup decks visible and soft-deletes the old rows', async () => {
    await seedDeck('From backup')
    await updateSettings({ new_per_day: 25 })
    const backup = await exportAll()
    await resetDb()
    const { deck: local } = await seedDeck('Local')

    await restoreReplace(backup)

    expect((await listDecks()).map((deck) => deck.name)).toEqual(['From backup'])
    expect(await db.decks.get(local.id)).toMatchObject({ deleted_at: expect.any(Number) })
    const localCards = await db.cards.where('deck_id').equals(local.id).toArray()
    expect(localCards.every((card) => card.deleted_at !== null)).toBe(true)
    const liveLogs = await db.review_log.filter((log) => log.deleted_at === null).toArray()
    expect(liveLogs).toHaveLength(1)
    expect((await getSettings()).new_per_day).toBe(25)
    const liveStates = await db.card_states.filter((state) => state.deleted_at === null).toArray()
    expect(liveStates).toHaveLength(4)
  })

  it('restores its own backup in place', async () => {
    const { deck } = await seedDeck()
    const backup = await exportAll()

    await restoreReplace(backup)

    expect(await listDecks()).toEqual([expect.objectContaining({ id: deck.id, deleted_at: null })])
    expect(await db.cards.filter((card) => card.deleted_at === null).count()).toBe(2)
    expect(await db.card_states.filter((state) => state.deleted_at === null).count()).toBe(4)
  })
})

describe('exportDeckCsv', () => {
  it('exports the deck in the import format', async () => {
    const { deck } = await seedDeck()
    expect(await exportDeckCsv(deck.id)).toBe(
      'front,back,example,example_translation,ipa,tags,notes\r\ncat,кошка,,,,animals,\r\ndog,собака,,,,,\r\n',
    )
  })
})
