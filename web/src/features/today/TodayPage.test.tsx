import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { createCard } from '@/db/cards'
import { createDeck } from '@/db/decks'
import { getMeta, setMeta } from '@/db/meta'
import { updateSettings } from '@/db/settings'
import { resetDb } from '@/test/db'
import { renderApp } from '@/test/render'

beforeEach(resetDb)

async function deckWithWords(count: number, new_per_day: number | null = null) {
  const deck = await createDeck({
    name: 'English',
    target_lang: 'en-GB',
    native_lang: 'ru',
    directions: 'forward',
    new_per_day,
  })
  for (let i = 0; i < count; i++) await createCard({ deck_id: deck.id, front: `word ${i}`, back: `слово ${i}` })
  return deck
}

describe('Today', () => {
  it('shows the new-card count, the estimate and the deck on the first day', async () => {
    await deckWithWords(3)
    renderApp('/')
    expect(await screen.findByText('New: 3')).toBeInTheDocument()
    expect(screen.queryByText(/To review/)).not.toBeInTheDocument()
    expect(screen.getByText('≈ 1 min')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /English.*EN.*3 due/ })).toBeInTheDocument()
    expect(screen.getByText('0 days')).toBeInTheDocument()
  })

  it('offers extra new words when nothing is due, and they add 10 new cards', async () => {
    await deckWithWords(25, 0)
    renderApp('/')
    expect(await screen.findByText(/Nothing due\./)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Learn extra new words' }))

    expect(await screen.findByText('10 cards')).toBeInTheDocument()
    expect((await getMeta('extra_new'))?.count).toBe(10)
  })

  it('asks to add words when there is nothing to study at all', async () => {
    await setMeta('onboarding_done', true)
    renderApp('/')
    expect(await screen.findByText('Add words to start studying.')).toBeInTheDocument()
  })

  it('keeps the chosen mode on this device and starts sessions in it', async () => {
    const deck = await deckWithWords(4)
    const router = renderApp('/')
    const choice = await screen.findByRole('button', { name: 'Choice' })
    expect(screen.getByRole('button', { name: 'Swipe' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(choice)
    await waitFor(() => expect(choice).toHaveAttribute('aria-pressed', 'true'))
    expect(await getMeta('study_mode')).toBe('choice')
    expect(screen.getByRole('link', { name: /English/ })).toHaveAttribute('href', `/study?deck=${deck.id}&mode=choice`)

    await userEvent.click(screen.getByRole('button', { name: 'Start' }))
    await waitFor(() => expect(router.state.location.search).toEqual({ mode: 'choice' }))
  })

  it('disables choice and listening with fewer than 4 words, but not listening by typing', async () => {
    await deckWithWords(3)
    await setMeta('study_mode', 'choice')
    renderApp('/')
    expect(await screen.findByRole('button', { name: 'Choice' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Listening' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Swipe' })).toHaveAttribute('aria-pressed', 'true')
    expect(
      screen.getByText('Choice and listening need at least 4 different words in one language.'),
    ).toBeInTheDocument()

    await updateSettings({ listening_answer: 'type' })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Listening' })).toBeEnabled())
    expect(screen.getByRole('button', { name: 'Typing' })).toBeEnabled()
  })
})
