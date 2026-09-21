import { beforeEach, describe, expect, it } from 'vitest'
import { resetDb } from '@/test/db'
import { createCard } from './cards'
import { createDeck, deleteDeck } from './decks'
import { loadStats } from './stats'
import { answer } from './study'

beforeEach(resetDb)

const deckInput = { target_lang: 'en-GB', native_lang: 'ru', directions: 'forward' as const, new_per_day: null }

describe('loadStats', () => {
  it('filters by deck and leaves deleted decks out', async () => {
    const english = await createDeck({ ...deckInput, name: 'English' })
    const polish = await createDeck({ ...deckInput, name: 'Polish', target_lang: 'pl-PL' })
    const gone = await createDeck({ ...deckInput, name: 'Gone' })
    const cards = await Promise.all([
      createCard({ deck_id: english.id, front: 'cat', back: 'кот' }),
      createCard({ deck_id: polish.id, front: 'kot', back: 'кот' }),
      createCard({ deck_id: gone.id, front: 'dog', back: 'пёс' }),
    ])
    for (const card of cards) {
      await answer({ card_id: card.id, direction: 'forward', rating: 3, mode: 'swipe', duration_ms: 5000 })
    }
    await deleteDeck(gone.id)

    const all = await loadStats(7, null, Date.now())
    expect(all.total).toBe(2)
    expect(all.kpis).toMatchObject({ totalCards: 2, currentStreak: 1 })
    const polishOnly = await loadStats(7, polish.id, Date.now())
    expect(polishOnly.total).toBe(1)
    expect(polishOnly.kpis.totalCards).toBe(1)
    expect(polishOnly.states.learning).toBe(1)
  })
})
