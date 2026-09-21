import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { createCard } from '@/db/cards'
import { createDeck } from '@/db/decks'
import { resetDb } from '@/test/db'
import { renderApp } from '@/test/render'

beforeEach(resetDb)

async function deckWithWords(fronts: string[]) {
  const deck = await createDeck({
    name: 'English',
    target_lang: 'en-GB',
    native_lang: 'ru',
    directions: 'forward',
    new_per_day: null,
  })
  for (const front of fronts) await createCard({ deck_id: deck.id, front, back: `${front}-ru` })
  return deck
}

describe('study session', () => {
  it('enables undo only after the first answer', async () => {
    const deck = await deckWithWords(['cat', 'dog'])
    renderApp(`/study?deck=${deck.id}`)
    await userEvent.click(await screen.findByRole('button', { name: 'Start' }))

    const undo = await screen.findByRole('button', { name: 'Undo last answer' })
    expect(undo).toBeDisabled()
    const know = screen.getByRole('button', { name: 'Know' })
    await waitFor(() => expect(know).toBeEnabled())
    await userEvent.click(know)
    await waitFor(() => expect(undo).toBeEnabled())
    expect(screen.getByRole('progressbar', { name: 'Session progress' })).toHaveAttribute('aria-valuenow', '1')

    await userEvent.click(undo)
    await waitFor(() => expect(undo).toBeDisabled())
    expect(screen.getByRole('progressbar', { name: 'Session progress' })).toHaveAttribute('aria-valuenow', '0')
  })

  it('closes without a confirmation when nothing was answered', async () => {
    const deck = await deckWithWords(['cat'])
    const router = renderApp(`/study?deck=${deck.id}`)
    await userEvent.click(await screen.findByRole('button', { name: 'Start' }))
    await screen.findByRole('progressbar', { name: 'Session progress' })
    await userEvent.click(screen.getByRole('button', { name: 'Close session' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
    expect(screen.queryByText('Leave the session?')).not.toBeInTheDocument()
  })

  it('asks before leaving once an answer was given', async () => {
    const deck = await deckWithWords(['cat', 'dog'])
    renderApp(`/study?deck=${deck.id}`)
    await userEvent.click(await screen.findByRole('button', { name: 'Start' }))
    const dontKnow = await screen.findByRole('button', { name: "Don't know" })
    await waitFor(() => expect(dontKnow).toBeEnabled())
    await userEvent.click(dontKnow)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Undo last answer' })).toBeEnabled())
    await userEvent.click(screen.getByRole('button', { name: 'Close session' }))
    expect(await screen.findByText('Leave the session?')).toBeInTheDocument()
  })

  it('shows a friendly message for an unknown deck', async () => {
    renderApp('/study?deck=nope')
    expect(await screen.findByText('This deck does not exist.')).toBeInTheDocument()
  })
})
