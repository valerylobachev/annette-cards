import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { createCard } from '@/db/cards'
import { createDeck } from '@/db/decks'
import { getMeta } from '@/db/meta'
import { updateSettings } from '@/db/settings'
import { resetDb } from '@/test/db'
import { renderApp } from '@/test/render'

beforeEach(resetDb)

async function deckWithWords(count: number) {
  const deck = await createDeck({
    name: 'English',
    target_lang: 'en-GB',
    native_lang: 'ru',
    directions: 'forward',
    new_per_day: null,
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
    await updateSettings({ new_per_day: 0 })
    await deckWithWords(25)
    renderApp('/')
    expect(await screen.findByText(/Nothing due\./)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Learn extra new words' }))

    expect(await screen.findByText('10 cards')).toBeInTheDocument()
    expect((await getMeta('extra_new'))?.count).toBe(10)
  })

  it('asks to add words when there is nothing to study at all', async () => {
    renderApp('/')
    expect(await screen.findByText('Add words to start studying.')).toBeInTheDocument()
  })
})
