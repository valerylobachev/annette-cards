import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDeck } from '@/db/decks'
import { setMeta } from '@/db/meta'
import { db } from '@/db/schema'
import type { Deck } from '@/domain/types'
import i18n from '@/i18n'
import { ME, type MockRoute, mockApi, sentBodies, setOnline } from '@/test/api'
import { resetDb } from '@/test/db'
import { renderApp } from '@/test/render'

const EMPTY_IDS = { decks: [], cards: [], card_states: [], review_log: [], settings: false }
const EMPTY_PUSH = { applied: EMPTY_IDS, skipped: EMPTY_IDS, rejected: [], server_time: Date.now() }
const FEATURES = { tts: false, commons: false, enrich: true, push: false }
const SUGGESTION = {
  back: 'черепаха',
  example: 'Żółw jest powolny.',
  example_translation: 'Черепаха медленная.',
  ipa: '/ʐuf/',
  notes: 'сущ., м. р.',
}

function mockServer(enrich: Omit<MockRoute, 'method' | 'path'> = { body: SUGGESTION }, features = FEATURES) {
  // The test's route comes first: the first matching route answers.
  return mockApi([
    { method: 'POST', path: '/api/enrich', ...enrich },
    { path: '/api/auth/me', body: ME },
    { path: '/api/meta', body: { version: '0.1.0', features } },
    { method: 'POST', path: '/api/sync/push', body: EMPTY_PUSH },
    { path: '/api/sync/pull', body: { changes: {}, cursor: 0, has_more: false } },
  ])
}

async function signIn() {
  await setMeta('account', { user_id: ME.id, email: ME.email, display_name: ME.display_name, is_admin: false })
}

function polishDeck(): Promise<Deck> {
  return createDeck({ name: 'Polish', target_lang: 'pl-PL', native_lang: 'ru', directions: 'both', new_per_day: null })
}

// `hidden`: an open confirm sheet hides the form from the accessibility tree.
const field = (name: RegExp) => screen.getByRole('textbox', { name, hidden: true })

beforeEach(async () => {
  await resetDb()
  await db.meta.put({ key: 'install_hint_shown', value: true })
  await db.meta.put({ key: 'onboarding_done', value: true })
})

afterEach(async () => {
  vi.unstubAllGlobals()
  setOnline(true)
  await act(() => i18n.changeLanguage('en'))
})

describe('Fill with AI in the card editor (S-08)', () => {
  it('is hidden when the server has no enrichment', async () => {
    await signIn()
    const deck = await polishDeck()
    mockServer(undefined, { ...FEATURES, enrich: false })
    renderApp(`/cards/new?deck=${deck.id}`)
    await screen.findByRole('textbox', { name: /Word or phrase/ })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(screen.queryByRole('button', { name: 'Fill with AI' })).not.toBeInTheDocument()
  })

  it('is disabled while Front is empty and offline', async () => {
    await signIn()
    await setMeta('server_features', FEATURES)
    const deck = await polishDeck()
    mockServer()
    renderApp(`/cards/new?deck=${deck.id}`)
    const button = await screen.findByRole('button', { name: 'Fill with AI' })
    expect(button).toBeDisabled()

    await userEvent.type(field(/Word or phrase/), 'żółw')
    expect(button).toBeEnabled()
    act(() => setOnline(false))
    expect(screen.getByRole('button', { name: 'Fill with AI' })).toBeDisabled()
    expect(screen.getByText('Available online')).toBeInTheDocument()
  })

  it('shows suggestions as ghosts and accepts one field', async () => {
    await signIn()
    const deck = await polishDeck()
    const api = mockServer()
    renderApp(`/cards/new?deck=${deck.id}`)
    await userEvent.type(await screen.findByRole('textbox', { name: /Word or phrase/ }), 'żółw')
    await userEvent.click(await screen.findByRole('button', { name: 'Fill with AI' }))

    await screen.findByRole('button', { name: 'Accept suggestion for Translation' })
    expect(screen.getAllByTestId('suggestion')).toHaveLength(5)
    expect(sentBodies(api, '/api/enrich')).toEqual([{ front: 'żółw', target_lang: 'pl-PL', native_lang: 'ru' }])
    expect(field(/Translation \*/)).toHaveValue('')

    await userEvent.click(screen.getByRole('button', { name: 'Accept suggestion for Translation' }))
    expect(field(/Translation \*/)).toHaveValue('черепаха')
    expect(screen.getAllByTestId('suggestion')).toHaveLength(4)

    // Typing into a field dismisses its ghost.
    await userEvent.type(field(/^Notes/), 'x')
    expect(screen.queryByRole('button', { name: 'Accept suggestion for Notes' })).not.toBeInTheDocument()
  })

  it('accept all fills empty fields and asks before replacing a filled one', async () => {
    await signIn()
    const deck = await polishDeck()
    mockServer()
    renderApp(`/cards/new?deck=${deck.id}`)
    await userEvent.type(await screen.findByRole('textbox', { name: /Word or phrase/ }), 'żółw')
    await userEvent.type(field(/^Notes/), 'animal')
    await userEvent.click(await screen.findByRole('button', { name: 'Fill with AI' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Accept all' }))

    const sheet = await screen.findByRole('dialog', { name: 'Replace the filled field?' })
    expect(field(/Translation \*/)).toHaveValue('черепаха')
    expect(field(/^Example translation/)).toHaveValue('Черепаха медленная.')
    expect(field(/^Notes/)).toHaveValue('animal')

    await userEvent.click(within(sheet).getByRole('button', { name: 'Replace' }))
    await waitFor(() => expect(field(/^Notes/)).toHaveValue('сущ., м. р.'))
    expect(screen.queryAllByTestId('suggestion')).toHaveLength(0)
  })

  it('keeps a filled field when the replacement is cancelled', async () => {
    await signIn()
    const deck = await polishDeck()
    mockServer()
    renderApp(`/cards/new?deck=${deck.id}`)
    await userEvent.type(await screen.findByRole('textbox', { name: /Word or phrase/ }), 'żółw')
    await userEvent.type(field(/Translation \*/), 'черепашка')
    await userEvent.click(await screen.findByRole('button', { name: 'Fill with AI' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Accept suggestion for Translation' }))

    const sheet = await screen.findByRole('dialog', { name: 'Replace the filled field?' })
    await userEvent.click(within(sheet).getByRole('button', { name: 'Cancel' }))
    expect(field(/Translation \*/)).toHaveValue('черепашка')
    expect(screen.getByRole('button', { name: 'Accept suggestion for Translation' })).toBeInTheDocument()
  })

  it('shows the quota error in the UI language and keeps manual input', async () => {
    await signIn()
    const deck = await polishDeck()
    mockServer({ status: 429, body: { code: 'enrich_quota_exceeded', details: null } })
    renderApp(`/cards/new?deck=${deck.id}`)
    await userEvent.type(await screen.findByRole('textbox', { name: /Word or phrase/ }), 'żółw')
    await userEvent.click(await screen.findByRole('button', { name: 'Fill with AI' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Daily AI limit reached, try tomorrow.')

    await act(() => i18n.changeLanguage('ru'))
    expect(screen.getByRole('alert')).toHaveTextContent('Дневной лимит ИИ исчерпан, попробуйте завтра.')
    await userEvent.type(field(/Перевод \*/), 'черепаха')
    expect(field(/Перевод \*/)).toHaveValue('черепаха')
  })

  it('shows one hint for provider and network errors', async () => {
    await signIn()
    const deck = await polishDeck()
    mockServer({ status: 504, body: { code: 'provider_timeout', details: null } })
    renderApp(`/cards/new?deck=${deck.id}`)
    await userEvent.type(await screen.findByRole('textbox', { name: /Word or phrase/ }), 'żółw')
    await userEvent.click(await screen.findByRole('button', { name: 'Fill with AI' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not get suggestions, fill in manually.')
  })
})

async function openQuickAdd() {
  await userEvent.click(await screen.findByRole('button', { name: 'Add word' }))
  const sheet = await screen.findByRole('dialog', { name: 'Quick add' })
  // The form appears once the account and the server features are read.
  await within(sheet).findByRole('textbox', { name: 'Word or phrase' })
  return sheet
}

describe('Quick add with suggestions (S-09)', () => {
  it('saves the word with the suggestions in one tap', async () => {
    await signIn()
    await setMeta('server_features', FEATURES)
    const deck = await polishDeck()
    mockServer()
    renderApp('/decks')
    const sheet = await openQuickAdd()
    await userEvent.type(within(sheet).getByRole('textbox', { name: 'Word or phrase' }), 'żółw{Enter}')

    const card = await within(sheet).findByRole('region', { name: 'AI suggestions' })
    expect(card).toHaveTextContent('черепаха')
    expect(card).toHaveTextContent('Żółw jest powolny.')
    await db.outbox.clear()
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save' }))

    await waitFor(async () => expect(await db.cards.count()).toBe(1))
    const saved = await db.cards.toArray()
    expect(saved[0]).toMatchObject({ deck_id: deck.id, front: 'żółw', ...SUGGESTION })
    expect(
      await db.card_states
        .where('card_id')
        .equals(saved[0]?.id ?? '')
        .count(),
    ).toBe(2)
    expect(await db.outbox.where('entity').equals('cards').count()).toBe(1)
    expect(await screen.findByText('Added')).toBeInTheDocument()
    expect(within(sheet).getByRole('textbox', { name: 'Word or phrase' })).toHaveValue('')
    expect(within(sheet).queryByRole('region', { name: 'AI suggestions' })).not.toBeInTheDocument()
  })

  it('drops the suggestion when the word changes', async () => {
    await signIn()
    await setMeta('server_features', FEATURES)
    await polishDeck()
    mockServer()
    renderApp('/decks')
    const sheet = await openQuickAdd()
    const word = within(sheet).getByRole('textbox', { name: 'Word or phrase' })
    await userEvent.type(word, 'żółw{Enter}')
    await within(sheet).findByRole('region', { name: 'AI suggestions' })

    await userEvent.type(word, 'e')
    expect(within(sheet).queryByRole('region', { name: 'AI suggestions' })).not.toBeInTheDocument()
    expect(within(sheet).getByRole('button', { name: 'Add' })).toBeInTheDocument()
  })

  it('falls back to the translation field when the request fails', async () => {
    await signIn()
    await setMeta('server_features', FEATURES)
    await polishDeck()
    mockServer({ status: 502, body: { code: 'provider_error', details: null } })
    renderApp('/decks')
    const sheet = await openQuickAdd()
    await userEvent.type(within(sheet).getByRole('textbox', { name: 'Word or phrase' }), 'kot{Enter}')

    const translation = await within(sheet).findByRole('textbox', { name: 'Translation' })
    expect(within(sheet).getByText('Could not get suggestions, fill in manually.')).toBeInTheDocument()
    await userEvent.type(translation, 'кот{Enter}')
    await waitFor(async () => expect(await db.cards.count()).toBe(1))
    expect((await db.cards.toArray())[0]).toMatchObject({ front: 'kot', back: 'кот', example: null })
  })

  it('never calls the API offline', async () => {
    await signIn()
    await setMeta('server_features', FEATURES)
    await polishDeck()
    const api = mockServer()
    setOnline(false)
    renderApp('/decks')
    const sheet = await openQuickAdd()
    await userEvent.type(within(sheet).getByRole('textbox', { name: 'Word or phrase' }), 'kot{Enter}')

    expect(await within(sheet).findByRole('textbox', { name: 'Translation' })).toHaveFocus()
    expect(sentBodies(api, '/api/enrich')).toHaveLength(0)
  })

  it('"Edit" opens the editor with the word and its suggestions as ghosts', async () => {
    await signIn()
    await setMeta('server_features', FEATURES)
    await polishDeck()
    mockServer()
    const router = renderApp('/decks')
    const sheet = await openQuickAdd()
    await userEvent.type(within(sheet).getByRole('textbox', { name: 'Word or phrase' }), 'żółw{Enter}')
    await within(sheet).findByRole('region', { name: 'AI suggestions' })
    await userEvent.click(within(sheet).getByRole('button', { name: 'Edit' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/cards/new'))
    expect(await screen.findByRole('textbox', { name: /Word or phrase/ })).toHaveValue('żółw')
    expect(screen.getAllByTestId('suggestion')).toHaveLength(5)
    expect(await db.cards.count()).toBe(0)
  })
})
