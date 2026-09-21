import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { createCard } from '@/db/cards'
import { createDeck } from '@/db/decks'
import { answer } from '@/db/study'
import { resetDb } from '@/test/db'
import { renderApp } from '@/test/render'

beforeEach(resetDb)

const deckInput = { native_lang: 'ru', directions: 'forward' as const, new_per_day: null }

async function studiedDecks() {
  const english = await createDeck({ ...deckInput, name: 'English', target_lang: 'en-GB' })
  const polish = await createDeck({ ...deckInput, name: 'Polish', target_lang: 'pl-PL' })
  const words: [string, string][] = [
    [english.id, 'cat'],
    [english.id, 'dog'],
    [polish.id, 'kot'],
  ]
  for (const [deck_id, front] of words) {
    const card = await createCard({ deck_id, front, back: `${front}-ru` })
    await answer({ card_id: card.id, direction: 'forward', rating: 3, mode: 'choice', duration_ms: 30_000 })
  }
  return { english, polish }
}

describe('Statistics', () => {
  it('shows the KPIs and charts, filtered by deck and period', async () => {
    const { polish } = await studiedDecks()
    renderApp('/stats')

    const kpis = await screen.findByRole('region', { name: 'Key numbers' })
    expect(within(kpis).getByText('Cards').nextSibling).toHaveTextContent('3')
    expect(within(kpis).getByText('Current streak').nextSibling).toHaveTextContent('1 day')
    expect(screen.getByText('3 answers in this period')).toBeInTheDocument()
    expect(screen.getByText('2 minutes in this period')).toBeInTheDocument()
    const states = screen.getByRole('list', { name: 'Card states' })
    expect(within(states).getByText('Learning').parentElement).toHaveTextContent('3')

    await screen.findByRole('option', { name: 'Polish' })
    await userEvent.selectOptions(screen.getByRole('combobox'), polish.id)
    await waitFor(() => expect(screen.getByText('1 answer in this period')).toBeInTheDocument())
    expect(within(kpis).getByText('Cards').nextSibling).toHaveTextContent('1')

    expect(screen.queryByText('Study days this year')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '1 year' }))
    expect(await screen.findByText('Study days this year')).toBeInTheDocument()
    expect(screen.getByText('1 study day')).toBeInTheDocument()
  })

  it('invites to study when there are no reviews yet', async () => {
    renderApp('/stats')
    expect(await screen.findByText('No reviews yet.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Go to Today' })).toBeInTheDocument()
  })
})
