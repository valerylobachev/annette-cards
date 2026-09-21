import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PushRequest } from '@/api/model'
import { createCard } from '@/db/cards'
import { createDeck } from '@/db/decks'
import { enqueueAll, wipeLocalData } from '@/db/localData'
import { getMeta, setMeta } from '@/db/meta'
import { db } from '@/db/schema'
import { updateSettings } from '@/db/settings'
import { signOut, unsyncedBeforeSignOut } from '@/features/auth/signOut'
import { ME, type MockRoute, mockApi, sentBodies, setOnline } from '@/test/api'
import { resetDb } from '@/test/db'
import { renderApp } from '@/test/render'
import { planFirstSync, runPlannedSync, toAccountInfo } from './firstSync'

const pending = toAccountInfo(ME)
const deckInput = {
  name: 'English',
  target_lang: 'en-GB',
  native_lang: 'ru',
  directions: 'forward',
  new_per_day: null,
} as const
const IDS = { decks: [], cards: [], card_states: [], review_log: [], settings: false }
const pushOk: MockRoute = {
  method: 'POST',
  path: '/api/sync/push',
  body: { applied: IDS, skipped: IDS, rejected: [], server_time: Date.now() },
}
const emptyPull: MockRoute = { path: '/api/sync/pull', body: { changes: {}, cursor: 1, has_more: false } }
const summary = (decks: number, cards: number): MockRoute => ({ path: '/api/sync/summary', body: { decks, cards } })

beforeEach(async () => {
  await resetDb()
  await db.meta.put({ key: 'install_hint_shown', value: true })
})
afterEach(() => {
  vi.unstubAllGlobals()
  setOnline(true)
})

async function localDeckWithCard() {
  const deck = await createDeck(deckInput)
  await createCard({ deck_id: deck.id, front: 'cat', back: 'кошка' })
  return deck
}

function pushed(api: ReturnType<typeof mockApi>) {
  return sentBodies(api, '/api/sync/push') as PushRequest[]
}

describe('planFirstSync', () => {
  it('syncs directly without local data, dropping leftovers such as the onboarding language', async () => {
    await updateSettings({ ui_language: 'ru' })
    const api = mockApi([summary(3, 40), pushOk, emptyPull])
    const plan = await planFirstSync(pending)
    expect(plan).toEqual({ kind: 'sync', account: { decks: 3, cards: 40 } })

    await runPlannedSync(pending, plan)
    expect(await db.settings.count()).toBe(0)
    expect(pushed(api).map((body) => body.changes)).toEqual([
      { decks: [], cards: [], card_states: [], review_log: [], settings: null },
    ])
    expect((await getMeta('account'))?.user_id).toBe('user-1')
  })

  it('pushes everything when the account is empty', async () => {
    await localDeckWithCard()
    await db.outbox.clear()
    const api = mockApi([summary(0, 0), pushOk, emptyPull])
    const plan = await planFirstSync(pending)
    expect(plan).toMatchObject({ kind: 'push', local: { decks: 1, cards: 1 } })

    await runPlannedSync(pending, plan)
    const [body] = pushed(api)
    expect(body?.changes.decks).toHaveLength(1)
    expect(body?.changes.cards).toHaveLength(1)
    expect(body?.changes.card_states).toHaveLength(1)
  })

  it('asks when both sides have data', async () => {
    await localDeckWithCard()
    mockApi([summary(3, 1210)])
    expect(await planFirstSync(pending)).toEqual({
      kind: 'choose',
      local: { decks: 1, cards: 1 },
      account: { decks: 3, cards: 1210 },
    })
  })

  it('does not ask again when signing in to the account this device synced with', async () => {
    await localDeckWithCard()
    await setMeta('account', pending)
    await setMeta('session_expired', true)
    await setMeta('sync_cursor', 42)
    const api = mockApi([pushOk, emptyPull])
    const plan = await planFirstSync(pending)
    expect(plan).toEqual({ kind: 'sync', account: null })
    await runPlannedSync(pending, plan)
    expect(await db.decks.count()).toBe(1)
    expect(api).not.toHaveBeenCalledWith('/api/sync/summary', expect.anything())
    expect(await getMeta('session_expired')).toBeUndefined()
  })
})

describe('enqueueAll and wipeLocalData', () => {
  it('queues every row exactly once', async () => {
    const deck = await localDeckWithCard()
    await updateSettings({ new_per_day: 20 })
    await db.outbox.add({ entity: 'decks', entity_id: deck.id })
    expect(await enqueueAll()).toBe(4)
    const entries = await db.outbox.toArray()
    expect(entries.map((entry) => entry.entity).sort()).toEqual(['card_states', 'cards', 'decks', 'settings'])
  })

  it('removes the account data and keeps device preferences', async () => {
    await localDeckWithCard()
    await setMeta('theme', 'dark')
    await setMeta('voice_pref', { en: 'voice-1' })
    await setMeta('account', pending)
    await setMeta('sync_cursor', 9)
    await setMeta('onboarding_done', true)
    await wipeLocalData()
    for (const table of [db.decks, db.cards, db.card_states, db.review_log, db.settings, db.outbox]) {
      expect(await table.count()).toBe(0)
    }
    expect((await db.meta.toArray()).map((row) => row.key).sort()).toEqual([
      'install_hint_shown',
      'theme',
      'voice_pref',
    ])
  })
})

describe('S-03 first sync', () => {
  async function openChoice() {
    await localDeckWithCard()
    await setMeta('pending_account', pending)
  }

  it('shows both counts and merges', async () => {
    await openChoice()
    const api = mockApi([summary(3, 1210), pushOk, emptyPull])
    const router = renderApp('/first-sync')
    expect(await screen.findByText('1 deck, 1 card')).toBeInTheDocument()
    expect(screen.getByText('3 decks, 1,210 cards')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Merge (recommended)' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
    expect(pushed(api)[0]?.changes.decks).toHaveLength(1)
    expect(await getMeta('account')).toEqual(pending)
    expect(await db.decks.count()).toBe(1)
  })

  it('uses the account data after a confirmation', async () => {
    await openChoice()
    await setMeta('theme', 'dark')
    const api = mockApi([summary(3, 10), pushOk, emptyPull])
    const router = renderApp('/first-sync')
    await userEvent.click(await screen.findByRole('button', { name: 'Use account data' }))
    expect(await screen.findByText('Remove the data on this device?')).toBeInTheDocument()
    await userEvent.click(screen.getAllByRole('button', { name: 'Use account data' }).at(-1) as HTMLElement)
    // The account pulled nothing here, so the empty device continues with onboarding.
    await waitFor(() => expect(router.state.location.pathname).toBe('/welcome'))
    expect(await getMeta('account')).toEqual(pending)
    expect(await db.decks.count()).toBe(0)
    expect(await getMeta('theme')).toBe('dark')
    expect(pushed(api)[0]?.changes.decks).toEqual([])
  })

  it('cancels: signs out on the server and keeps the local data', async () => {
    await openChoice()
    const api = mockApi([summary(3, 10), { method: 'POST', path: '/api/auth/logout', status: 204 }])
    renderApp('/first-sync')
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(api).toHaveBeenCalledWith('/api/auth/logout', expect.anything()))
    expect(await getMeta('pending_account')).toBeUndefined()
    expect(await getMeta('account')).toBeUndefined()
    expect(await db.decks.count()).toBe(1)
  })
})

describe('sign-out', () => {
  it('reports unsynced changes when offline', async () => {
    await setMeta('account', pending)
    await localDeckWithCard()
    setOnline(false)
    expect(await unsyncedBeforeSignOut()).toBe(3)
  })

  it('asks before losing unsynced changes, then wipes the device and the caches', async () => {
    await setMeta('account', pending)
    await localDeckWithCard()
    setOnline(false)
    const deleted: string[] = []
    vi.stubGlobal('caches', {
      keys: async () => ['workbox-precache-v2-app', 'audio-v1'],
      delete: async (key: string) => deleted.push(key),
    })
    const router = renderApp('/settings/account')
    await userEvent.click(await screen.findByRole('button', { name: 'Sign out' }))
    expect(await screen.findByText('3 changes are not synced')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Sign out anyway' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/welcome'))
    expect(await db.decks.count()).toBe(0)
    expect(await db.outbox.count()).toBe(0)
    expect(await getMeta('account')).toBeUndefined()
    expect(deleted).toEqual(['audio-v1'])
  })

  it('signs out without asking when everything is synced', async () => {
    await setMeta('account', pending)
    const api = mockApi([{ method: 'POST', path: '/api/auth/logout', status: 204 }])
    await signOut()
    expect(api).toHaveBeenCalledWith('/api/auth/logout', expect.anything())
    expect(await getMeta('account')).toBeUndefined()
  })
})
