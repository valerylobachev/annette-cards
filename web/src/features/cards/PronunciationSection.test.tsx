import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyServerAudio, createCard } from '@/db/cards'
import { createDeck } from '@/db/decks'
import { setMeta } from '@/db/meta'
import { db } from '@/db/schema'
import type { Card } from '@/domain/types'
import i18n from '@/i18n'
import { download } from '@/lib/audio/audioCache'
import { resetAudioPlayer } from '@/lib/audio/playCard'
import { ME, type MockRoute, mockApi, sentBodies, setOnline } from '@/test/api'
import { clipResponse, installFakeCaches } from '@/test/caches'
import { resetDb } from '@/test/db'
import { renderApp } from '@/test/render'

const ATTRIBUTION = 'Derbeth · CC BY 2.5 · https://commons.wikimedia.org/wiki/File:Pl-%C5%BC%C3%B3%C5%82w.ogg'
const EMPTY_IDS = { decks: [], cards: [], card_states: [], review_log: [], settings: false }
const EMPTY_PUSH = { applied: EMPTY_IDS, skipped: EMPTY_IDS, rejected: [], server_time: Date.now() }
const ALL_FEATURES = { tts: true, commons: true, enrich: false, push: false }

/** Clips as the server sends them; other requests go to the JSON mock. */
const clips: Record<string, Response> = {}

function mockServer(routes: MockRoute[], features = ALL_FEATURES) {
  // The test's routes come first: the first matching route answers.
  const api = mockApi([
    ...routes,
    { path: '/api/auth/me', body: ME },
    { path: '/api/meta', body: { version: '0.1.0', features } },
    { method: 'POST', path: '/api/sync/push', body: EMPTY_PUSH },
    { path: '/api/sync/pull', body: { changes: {}, cursor: 0, has_more: false } },
  ])
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input), 'http://localhost').pathname
    const clip = clips[path]
    if (clip) return clip.clone()
    return api(input, init)
  })
  return api
}

async function signIn() {
  await setMeta('account', { user_id: ME.id, email: ME.email, display_name: ME.display_name, is_admin: false })
}

async function englishCard(): Promise<Card> {
  const deck = await createDeck({
    name: 'English',
    target_lang: 'en-GB',
    native_lang: 'ru',
    directions: 'forward',
    new_per_day: null,
  })
  const card = await createCard({ deck_id: deck.id, front: 'read', back: 'читать' })
  await db.outbox.clear()
  return card
}

beforeEach(async () => {
  await resetDb()
  await db.meta.put({ key: 'install_hint_shown', value: true })
  installFakeCaches()
  resetAudioPlayer()
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  URL.createObjectURL = vi.fn(() => 'blob:clip')
  URL.revokeObjectURL = vi.fn()
  for (const key of Object.keys(clips)) delete clips[key]
})

afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  setOnline(true)
  await act(() => i18n.changeLanguage('en'))
})

const section = () => screen.findByRole('region', { name: 'Pronunciation' })

describe('pronunciation section (S-07)', () => {
  it('shows the system voice and no server actions when signed out', async () => {
    const card = await englishCard()
    mockServer([])
    renderApp(`/cards/${card.id}`)
    expect(await section()).toHaveTextContent('System voice')
    expect(screen.queryByRole('button', { name: 'Generate audio' })).not.toBeInTheDocument()
  })

  it('generates audio: the card gets the audio_id without an outbox entry, then syncs', async () => {
    await signIn()
    const card = await englishCard()
    clips['/api/audio/a1'] = clipResponse('azure')
    const api = mockServer([
      { method: 'POST', path: `/api/cards/${card.id}/audio`, body: { audio_id: 'a1', attribution: null } },
    ])
    renderApp(`/cards/${card.id}`)
    await userEvent.click(await screen.findByRole('button', { name: 'Generate audio' }))

    await waitFor(async () => expect((await db.cards.get(card.id))?.audio_id).toBe('a1'))
    expect(sentBodies(api, `/api/cards/${card.id}/audio`)).toEqual([{ source: 'tts' }])
    expect(await db.outbox.count()).toBe(0)
    await waitFor(() => expect(screen.getByTestId('audio-source')).toHaveTextContent('Generated'))
    // The new clip is played once and the change is pulled.
    await waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalled())
    await waitFor(() => expect(sentBodies(api, '/api/sync/pull').length).toBeGreaterThan(1))
  })

  it('pushes unsynced edits of the card before the server changes it', async () => {
    await signIn()
    const card = await englishCard()
    await db.outbox.add({ entity: 'cards', entity_id: card.id })
    const order: string[] = []
    const api = mockServer([
      {
        method: 'POST',
        path: '/api/sync/push',
        respond: () => {
          order.push('push')
          return EMPTY_PUSH
        },
      },
      {
        method: 'POST',
        path: `/api/cards/${card.id}/audio`,
        respond: () => {
          order.push('attach')
          return { audio_id: 'a1', attribution: null }
        },
      },
    ])
    renderApp(`/cards/${card.id}`)
    // Wait for the start sync, then leave a pending edit again.
    await waitFor(() => expect(order).toContain('push'))
    order.length = 0
    await db.outbox.add({ entity: 'cards', entity_id: card.id })
    await userEvent.click(await screen.findByRole('button', { name: 'Generate audio' }))
    await waitFor(() => expect(order.slice(0, 2)).toEqual(['push', 'attach']))
    expect(api).toHaveBeenCalled()
  })

  it('reports that no recording was found', async () => {
    await signIn()
    const card = await englishCard()
    mockServer([{ method: 'POST', path: `/api/cards/${card.id}/audio`, status: 404, body: { code: 'not_found' } }])
    renderApp(`/cards/${card.id}`)
    await userEvent.click(await screen.findByRole('button', { name: 'Find recording' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('No recording found for this word.')

    await act(() => i18n.changeLanguage('ru'))
    await userEvent.click(await screen.findByRole('button', { name: 'Найти запись' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Для этого слова запись не найдена.')
    expect((await db.cards.get(card.id))?.audio_id).toBeNull()
  })

  it('localizes other errors from their code', async () => {
    await signIn()
    const card = await englishCard()
    mockServer([{ method: 'POST', path: `/api/cards/${card.id}/audio`, status: 429, body: { code: 'rate_limited' } }])
    renderApp(`/cards/${card.id}`)
    await userEvent.click(await screen.findByRole('button', { name: 'Generate audio' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many attempts.')
  })

  it('hides the actions of features the server does not offer', async () => {
    await signIn()
    const card = await englishCard()
    mockServer([], { tts: false, commons: true, enrich: false, push: false })
    renderApp(`/cards/${card.id}`)
    expect(await screen.findByRole('button', { name: 'Find recording' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Generate audio' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove audio' })).not.toBeInTheDocument()
  })

  it('offline: the actions are disabled with the offline hint', async () => {
    await signIn()
    await setMeta('server_features', ALL_FEATURES)
    const card = await englishCard()
    mockServer([])
    setOnline(false)
    renderApp(`/cards/${card.id}`)
    expect(await screen.findByRole('button', { name: 'Generate audio' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Find recording' })).toBeDisabled()
    expect(screen.getByText('Available online')).toBeInTheDocument()
  })

  it('shows a cached recording with its attribution and removes it', async () => {
    await signIn()
    const card = await englishCard()
    await applyServerAudio(card.id, 'r1')
    clips['/api/audio/r1'] = clipResponse('commons', ATTRIBUTION)
    const api = mockServer([{ method: 'DELETE', path: `/api/cards/${card.id}/audio`, status: 204 }])
    await download('r1')
    renderApp(`/cards/${card.id}`)
    await waitFor(() => expect(screen.getByTestId('audio-source')).toHaveTextContent('Recording'))
    expect(await section()).toHaveTextContent(ATTRIBUTION)

    await userEvent.click(await screen.findByRole('button', { name: 'Remove audio' }))
    await waitFor(async () => expect((await db.cards.get(card.id))?.audio_id).toBeNull())
    expect(api).toHaveBeenCalledWith(`/api/cards/${card.id}/audio`, expect.objectContaining({ method: 'DELETE' }))
    await waitFor(() => expect(screen.getByTestId('audio-source')).toHaveTextContent('System voice'))
    expect(await db.outbox.count()).toBe(0)
  })
})
