import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Changes, PushRequest, PushResponse } from '@/api/model'
import { createCard, updateCard } from '@/db/cards'
import { createDeck, updateDeck } from '@/db/decks'
import { getMeta, setMeta } from '@/db/meta'
import { readOutboxRows } from '@/db/remote'
import { db } from '@/db/schema'
import { answer, undoAnswer } from '@/db/study'
import { setClock } from '@/lib/clock'
import { ME, mockApi, setOnline } from '@/test/api'
import { resetDb } from '@/test/db'
import { engineState, resetEngine, syncNow } from './engine'
import { pullAll } from './pull'
import { pushBatches, pushOutbox } from './push'

const T0 = 1_760_000_000_000
const deckInput = {
  name: 'English',
  target_lang: 'en-GB',
  native_lang: 'ru',
  directions: 'forward',
  new_per_day: null,
} as const

beforeEach(async () => {
  await resetDb()
  resetEngine()
  setClock(() => T0)
  await setMeta('account', { user_id: ME.id, email: ME.email, display_name: ME.display_name, is_admin: false })
})
afterEach(() => {
  vi.unstubAllGlobals()
  setOnline(true)
})

/** Server answer that applies every pushed row. */
function applyAll({ body }: { body: unknown }): PushResponse {
  const { changes } = body as PushRequest
  return {
    applied: {
      decks: (changes.decks ?? []).map((row) => row.id),
      cards: (changes.cards ?? []).map((row) => row.id),
      card_states: (changes.card_states ?? []).map((row) => `${row.card_id}:${row.direction}`),
      review_log: (changes.review_log ?? []).map((row) => row.id),
      settings: Boolean(changes.settings),
    },
    skipped: { decks: [], cards: [], card_states: [], review_log: [], settings: false },
    rejected: [],
    server_time: Date.now(),
  }
}

const emptyPull = { path: '/api/sync/pull', body: { changes: {}, cursor: 0, has_more: false } }

function pushedBodies(api: ReturnType<typeof mockApi>): PushRequest[] {
  return api.mock.calls
    .filter(([input]) => String(input).startsWith('/api/sync/push'))
    .map(([, init]) => JSON.parse(String(init?.body)))
}

describe('push', () => {
  it('sends parents first, even when a deck was edited after its card', async () => {
    const deck = await createDeck(deckInput)
    const card = await createCard({ deck_id: deck.id, front: 'cat', back: 'кошка' })
    await updateDeck(deck.id, { name: 'English B2' })

    const rows = await readOutboxRows()
    expect(rows.map((row) => row.entity)).toEqual(['cards', 'card_states', 'decks'])
    const batches = pushBatches(rows, 2)
    expect(batches.map((batch) => batch.map((row) => row.entity))).toEqual([['decks', 'cards'], ['card_states']])
    expect(batches[0]?.[1]?.row).toMatchObject({ id: card.id })
  })

  it('splits the outbox into requests of at most 500 rows', async () => {
    const deck = await createDeck(deckInput)
    await db.transaction('rw', db.outbox, async () => {
      for (let i = 0; i < 1200; i++) await db.outbox.add({ entity: 'decks', entity_id: deck.id })
    })
    const api = mockApi([{ method: 'POST', path: '/api/sync/push', respond: applyAll }])
    await pushOutbox()
    expect(pushedBodies(api).map((body) => body.changes.decks?.length)).toEqual([500, 500, 201])
    expect(await db.outbox.count()).toBe(0)
  })

  it('clears applied and skipped rows, reports rejected ones and keeps a row edited during the request', async () => {
    const deck = await createDeck(deckInput)
    const card = await createCard({ deck_id: deck.id, front: 'cat', back: 'кошка' })
    mockApi([
      {
        method: 'POST',
        path: '/api/sync/push',
        respond: async (request) => {
          await updateCard(card.id, { back: 'кот' })
          const answer = applyAll(request)
          answer.applied.decks = []
          answer.skipped.decks = [deck.id]
          answer.applied.card_states = []
          return {
            ...answer,
            rejected: [{ entity: 'card_states', id: `${card.id}:forward`, code: 'validation_failed' }],
          }
        },
      },
    ])
    const result = await pushOutbox()
    expect(result.rejected).toEqual([{ entity: 'card_states', id: `${card.id}:forward`, code: 'validation_failed' }])
    expect(result.pushed).toBe(2)
    expect(await db.outbox.toArray()).toEqual([{ seq: expect.any(Number), entity: 'cards', entity_id: card.id }])
  })

  it('carries the practice flag and the settings document', async () => {
    const deck = await createDeck(deckInput)
    const card = await createCard({ deck_id: deck.id, front: 'cat', back: 'кошка' })
    await answer({ card_id: card.id, direction: 'forward', rating: 3, mode: 'swipe', duration_ms: 900, practice: true })
    await db.settings.put({ id: 'user', new_per_day: 25, updated_at: T0, updated_by: 'device-x' })
    await db.outbox.add({ entity: 'settings', entity_id: 'user' })
    const api = mockApi([{ method: 'POST', path: '/api/sync/push', respond: applyAll }])
    await pushOutbox()
    const [body] = pushedBodies(api)
    expect(body?.changes.review_log?.[0]).toMatchObject({ practice: true, rating: 3 })
    expect(body?.changes.settings).toEqual({ data: { new_per_day: 25 }, updated_at: T0, updated_by: 'device-x' })
  })
})

describe('pull', () => {
  const remoteDeck = (updated_at: number, extra = {}) => ({
    ...deckInput,
    id: 'deck-r',
    name: `remote ${updated_at}`,
    archived_at: null,
    created_at: 1,
    updated_at,
    updated_by: 'device-remote',
    deleted_at: null,
    ...extra,
  })

  it('merges pages by last-write-wins, saves the cursor per page and creates no outbox entries', async () => {
    await db.decks.put({ ...remoteDeck(T0 + 10), name: 'local newer', updated_by: 'device-local' })
    const pages: Record<number, { changes: Changes; cursor: number; has_more: boolean }> = {
      0: { changes: { decks: [remoteDeck(T0)] }, cursor: 5, has_more: true },
      5: {
        changes: {
          decks: [remoteDeck(T0 + 20, { id: 'deck-2' })],
          settings: { data: { new_per_day: 30 }, updated_at: T0, updated_by: 'device-remote' },
        },
        cursor: 9,
        has_more: false,
      },
    }
    const cursors: number[] = []
    mockApi([
      {
        path: '/api/sync/pull',
        respond: async ({ url }) => {
          const cursor = Number(url.searchParams.get('cursor'))
          cursors.push(cursor)
          if (cursor === 5) expect(await getMeta('sync_cursor')).toBe(5)
          return pages[cursor]
        },
      },
    ])

    expect(await pullAll()).toBe(3)
    expect(cursors).toEqual([0, 5])
    expect(await getMeta('sync_cursor')).toBe(9)
    expect((await db.decks.get('deck-r'))?.name).toBe('local newer')
    expect((await db.decks.get('deck-2'))?.name).toBe(`remote ${T0 + 20}`)
    expect(await db.settings.get('user')).toEqual({
      id: 'user',
      new_per_day: 30,
      updated_at: T0,
      updated_by: 'device-remote',
    })
    expect(await db.outbox.count()).toBe(0)
  })

  it('applies a newer remote row and takes over an undo of a review', async () => {
    const deck = await createDeck(deckInput)
    const card = await createCard({ deck_id: deck.id, front: 'cat', back: 'кошка' })
    const { log_id } = await answer({
      card_id: card.id,
      direction: 'forward',
      rating: 3,
      mode: 'swipe',
      duration_ms: 900,
    })
    const log = await db.review_log.get(log_id)
    await db.outbox.clear()
    mockApi([
      {
        path: '/api/sync/pull',
        body: {
          changes: {
            cards: [{ ...card, front: 'dog', updated_at: T0 + 100, updated_by: 'device-remote' }],
            review_log: [{ ...log, rating: 1, deleted_at: T0 + 50, updated_at: T0 + 50, updated_by: 'device-remote' }],
          },
          cursor: 3,
          has_more: false,
        },
      },
    ])
    await pullAll()
    expect((await db.cards.get(card.id))?.front).toBe('dog')
    // Only deleted_at (with its stamp) changes on a review; the rating stays as first written.
    expect(await db.review_log.get(log_id)).toMatchObject({ rating: 3, deleted_at: T0 + 50 })
    expect(await db.outbox.count()).toBe(0)
  })
})

describe('engine', () => {
  it('pushes, pulls, logs the run and deletes cards left in a deck deleted elsewhere', async () => {
    const deck = await createDeck(deckInput)
    const card = await createCard({ deck_id: deck.id, front: 'cat', back: 'кошка' })
    const deleted = { ...deck, deleted_at: T0 + 5, updated_at: T0 + 5, updated_by: 'device-remote' }
    mockApi([
      { method: 'POST', path: '/api/sync/push', respond: applyAll },
      { path: '/api/sync/pull', body: { changes: { decks: [deleted] }, cursor: 7, has_more: false } },
    ])
    await syncNow('manual')

    const [entry] = (await getMeta('sync_log')) ?? []
    expect(entry).toMatchObject({ status: 'ok', pushed: 3, pulled: 1, rejected: [] })
    expect(await getMeta('last_sync_at')).toBe(T0)
    expect((await db.cards.get(card.id))?.deleted_at).toBe(T0 + 5)
    // The cascade is a local change: it is queued for the next push.
    expect((await db.outbox.toArray()).map((row) => row.entity).sort()).toEqual(['card_states', 'cards'])
  })

  it('runs one sync at a time and one more for calls made meanwhile', async () => {
    let pushes = 0
    const runningDuringPush: boolean[] = []
    mockApi([
      {
        method: 'POST',
        path: '/api/sync/push',
        respond: async (request) => {
          pushes += 1
          runningDuringPush.push(engineState().running)
          await new Promise((resolve) => setTimeout(resolve, 10))
          return applyAll(request)
        },
      },
      emptyPull,
    ])
    const first = syncNow('manual')
    void syncNow('change')
    void syncNow('change')
    await first
    expect(pushes).toBe(2)
    expect(runningDuringPush).toEqual([true, true])
    expect(engineState().running).toBe(false)
  })

  it('marks the session expired on 401 and stops', async () => {
    mockApi([{ method: 'POST', path: '/api/sync/push', status: 401, body: { code: 'unauthorized' } }])
    await syncNow('manual')
    expect(await getMeta('session_expired')).toBe(true)
    expect((await getMeta('sync_log'))?.[0]).toMatchObject({ status: 'error', error_code: 'unauthorized' })
    const api = mockApi([])
    await syncNow('manual')
    expect(api).not.toHaveBeenCalled()
  })

  it('does nothing offline or signed out', async () => {
    const api = mockApi([])
    setOnline(false)
    await syncNow('manual')
    setOnline(true)
    await db.meta.delete('account')
    await syncNow('manual')
    expect(api).not.toHaveBeenCalled()
    expect(await getMeta('sync_log')).toBeUndefined()
  })

  it('logs a network failure and keeps the outbox', async () => {
    await createDeck(deckInput)
    mockApi([])
    await syncNow('manual')
    expect((await getMeta('sync_log'))?.[0]).toMatchObject({ status: 'error', error_code: 'network' })
    expect(await db.outbox.count()).toBe(1)
    resetEngine()
  })

  it('stores a clock skew over 5 minutes and clears it again', async () => {
    const offset = { value: 6 * 60_000 }
    mockApi([
      {
        method: 'POST',
        path: '/api/sync/push',
        respond: (request) => ({ ...applyAll(request), server_time: Date.now() - offset.value }),
      },
      emptyPull,
    ])
    await syncNow('manual')
    expect(await getMeta('clock_skew_ms')).toBeGreaterThan(5 * 60_000)
    offset.value = 1000
    await syncNow('manual')
    expect(await getMeta('clock_skew_ms')).toBeUndefined()
  })

  it('keeps an undone answer undone after the push', async () => {
    const deck = await createDeck(deckInput)
    const card = await createCard({ deck_id: deck.id, front: 'cat', back: 'кошка' })
    const { log_id } = await answer({
      card_id: card.id,
      direction: 'forward',
      rating: 3,
      mode: 'swipe',
      duration_ms: 900,
    })
    await undoAnswer(log_id)
    const api = mockApi([{ method: 'POST', path: '/api/sync/push', respond: applyAll }, emptyPull])
    await syncNow('manual')
    const logs = pushedBodies(api).flatMap((body) => body.changes.review_log ?? [])
    expect(logs).toEqual([expect.objectContaining({ id: log_id, deleted_at: T0 })])
  })
})
