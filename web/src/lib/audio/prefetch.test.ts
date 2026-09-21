import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyServerAudio, audioIdsOfActiveDecks, createCard } from '@/db/cards'
import { archiveDeck, createDeck, type DeckInput, deleteDeck } from '@/db/decks'
import { setMeta } from '@/db/meta'
import { db } from '@/db/schema'
import { clipResponse, installFakeCaches } from '@/test/caches'
import { resetDb } from '@/test/db'
import { download, getCached } from './audioCache'
import { audioIdsToPrefetch, prefetchAudio } from './prefetch'

const deckInput = (name: string): DeckInput => ({
  name,
  target_lang: 'en-GB',
  native_lang: 'ru',
  directions: 'forward',
  new_per_day: null,
})

async function cardWithAudio(deckId: string, front: string, audioId: string) {
  const card = await createCard({ deck_id: deckId, front, back: 'x' })
  await applyServerAudio(card.id, audioId)
  return card
}

beforeEach(async () => {
  await resetDb()
  installFakeCaches()
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => clipResponse('azure')),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('applyServerAudio', () => {
  it('sets audio_id without a stamp or an outbox entry', async () => {
    const deck = await createDeck(deckInput('English'))
    const card = await createCard({ deck_id: deck.id, front: 'read', back: 'читать' })
    await db.outbox.clear()

    await applyServerAudio(card.id, 'a1')
    const stored = await db.cards.get(card.id)
    expect(stored).toMatchObject({ audio_id: 'a1', updated_at: card.updated_at, updated_by: card.updated_by })
    expect(await db.outbox.count()).toBe(0)

    await applyServerAudio(card.id, null)
    expect((await db.cards.get(card.id))?.audio_id).toBeNull()
    expect(await db.outbox.count()).toBe(0)
  })
})

describe('audio prefetch', () => {
  it('fetches clips of active decks that are not cached yet', async () => {
    const active = await createDeck(deckInput('Active'))
    const archived = await createDeck(deckInput('Archived'))
    const deleted = await createDeck(deckInput('Deleted'))
    await cardWithAudio(active.id, 'read', 'a1')
    await cardWithAudio(active.id, 'lead', 'a2')
    await cardWithAudio(active.id, 'same clip', 'a2')
    const gone = await cardWithAudio(active.id, 'gone', 'a3')
    await db.cards.update(gone.id, { deleted_at: 5 })
    await createCard({ deck_id: active.id, front: 'no audio', back: 'x' })
    await cardWithAudio(archived.id, 'old', 'b1')
    await cardWithAudio(deleted.id, 'removed', 'c1')
    await archiveDeck(archived.id)
    await deleteDeck(deleted.id)

    expect((await audioIdsOfActiveDecks()).sort()).toEqual(['a1', 'a2'])
    await download('a1')
    expect(await audioIdsToPrefetch()).toEqual(['a2'])
  })

  it('runs only when turned on and caches the missing clips', async () => {
    const deck = await createDeck(deckInput('Active'))
    await cardWithAudio(deck.id, 'read', 'a1')
    await cardWithAudio(deck.id, 'lead', 'a2')
    await cardWithAudio(deck.id, 'bead', 'a3')

    expect(await prefetchAudio()).toBe(0)
    expect(fetch).not.toHaveBeenCalled()

    await setMeta('audio_prefetch', true)
    expect(await prefetchAudio()).toBe(3)
    for (const id of ['a1', 'a2', 'a3']) expect(await getCached(id)).toBeDefined()
    expect(await prefetchAudio()).toBe(0)
  })

  it('stops when the network fails', async () => {
    const deck = await createDeck(deckInput('Active'))
    await cardWithAudio(deck.id, 'read', 'a1')
    await setMeta('audio_prefetch', true)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      }),
    )
    expect(await prefetchAudio()).toBe(0)
  })
})
