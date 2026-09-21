import { screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { createCard } from '@/db/cards'
import { createDeck } from '@/db/decks'
import type { Directions } from '@/domain/types'
import { resetDb } from '@/test/db'
import { renderApp } from '@/test/render'

beforeEach(resetDb)

async function cardIn(directions: Directions) {
  const deck = await createDeck({
    name: 'English',
    target_lang: 'en-GB',
    native_lang: 'ru',
    directions,
    new_per_day: null,
  })
  return createCard({
    deck_id: deck.id,
    front: 'take off',
    back: 'взлетать',
    example: 'Planes take off.',
    tags: ['verbs'],
  })
}

describe('card view', () => {
  it('shows two progress blocks for a both-directions deck', async () => {
    const card = await cardIn('both')
    renderApp(`/cards/${card.id}`)
    expect(await screen.findByRole('heading', { level: 1, name: 'take off' })).toBeInTheDocument()
    expect(screen.getByText('Planes take off.')).toBeInTheDocument()
    expect(screen.getByText('#verbs')).toBeInTheDocument()
    expect(await screen.findByRole('article', { name: 'Word → translation' })).toBeInTheDocument()
    expect(screen.getByRole('article', { name: 'Translation → word' })).toBeInTheDocument()
  })

  it('shows one progress block for a forward deck', async () => {
    const card = await cardIn('forward')
    renderApp(`/cards/${card.id}`)
    expect(await screen.findByRole('article', { name: 'Word → translation' })).toBeInTheDocument()
    expect(screen.queryByRole('article', { name: 'Translation → word' })).not.toBeInTheDocument()
    expect(screen.getAllByText('Not studied yet')).toHaveLength(1)
  })

  it('reports a missing card', async () => {
    renderApp('/cards/nope')
    expect(await screen.findByText('This card does not exist.')).toBeInTheDocument()
  })
})
