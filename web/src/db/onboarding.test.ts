import { beforeEach, describe, expect, it } from 'vitest'
import { ValidationError } from '@/domain/validation'
import { resetDb } from '@/test/db'
import { createDeck, deleteDeck, listDecks } from './decks'
import { getMeta, setMeta } from './meta'
import { completeOnboarding, isFirstRun } from './onboarding'
import { db } from './schema'
import { getStoredSettings } from './settings'

beforeEach(resetDb)

const deckInput = {
  name: 'English',
  target_lang: 'en-GB',
  native_lang: 'ru',
  directions: 'both',
  new_per_day: null,
} as const

describe('first run', () => {
  it('is a first run on an empty database', async () => {
    expect(await isFirstRun()).toBe(true)
  })

  it('is not a first run when a deck exists, even a deleted one', async () => {
    const deck = await createDeck(deckInput)
    await deleteDeck(deck.id)
    expect(await listDecks()).toHaveLength(0)
    expect(await isFirstRun()).toBe(false)
  })

  it('is not a first run once onboarding was finished', async () => {
    await setMeta('onboarding_done', true)
    expect(await isFirstRun()).toBe(false)
  })
})

describe('completeOnboarding', () => {
  it('stores the goal, the first deck and the flag in one outboxed transaction', async () => {
    const deck = await completeOnboarding({ new_per_day: 10 }, deckInput)
    expect(await getStoredSettings()).toEqual({ new_per_day: 10 })
    expect((await listDecks()).map((d) => d.id)).toEqual([deck.id])
    expect(await getMeta('onboarding_done')).toBe(true)
    const outbox = await db.outbox.toArray()
    expect(outbox.map((entry) => entry.entity).sort()).toEqual(['decks', 'settings'])
    expect(await isFirstRun()).toBe(false)
  })

  it('writes nothing when the deck is invalid', async () => {
    await expect(completeOnboarding({ new_per_day: 10 }, { ...deckInput, name: ' ' })).rejects.toBeInstanceOf(
      ValidationError,
    )
    await expect(completeOnboarding({ new_per_day: 0 }, deckInput)).rejects.toBeInstanceOf(ValidationError)
    expect(await getStoredSettings()).toEqual({})
    expect(await isFirstRun()).toBe(true)
    expect(await db.outbox.count()).toBe(0)
  })
})
