import { describe, expect, it } from 'vitest'
import { summarizeDeck } from './deckStats'
import { newCardState } from './directions'
import type { Deck } from './types'

const deck = { directions: 'forward' } as Deck

describe('summarizeDeck', () => {
  it('counts states of active directions only', () => {
    const states = [
      newCardState('a', 'forward', 0),
      newCardState('a', 'reverse', 0),
      { ...newCardState('b', 'forward', 0), state: 2 as const, scheduled_days: 30, due: 500 },
      { ...newCardState('c', 'forward', 0), state: 1 as const, due: 2_000 },
    ]
    expect(summarizeDeck(deck, 3, states, 1_000)).toEqual({ cards: 3, new: 1, learning: 1, mature: 1, due: 1 })
  })
})
