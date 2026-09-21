import { describe, expect, it } from 'vitest'
import { type CardWithStates, countByFilter, matchesFilter, queryCards } from './cardFilters'
import { newCardState } from './directions'
import type { Card, CardState, Direction } from './types'

function card(id: string, front: string, extra: Partial<Card> = {}): Card {
  return {
    id,
    deck_id: 'd1',
    front,
    back: `${front}-ru`,
    example: null,
    example_translation: null,
    ipa: null,
    tags: [],
    notes: null,
    audio_id: null,
    created_at: 0,
    updated_at: 0,
    updated_by: 'test',
    deleted_at: null,
    ...extra,
  }
}

function state(card_id: string, direction: Direction, extra: Partial<CardState> = {}): CardState {
  return { ...newCardState(card_id, direction, 0), ...extra }
}

describe('filters', () => {
  it('difficult includes a card with 3 lapses on the reverse direction only', () => {
    const item: CardWithStates = {
      card: card('a', 'a'),
      states: [state('a', 'forward', { state: 2 }), state('a', 'reverse', { state: 2, lapses: 3 })],
    }
    expect(matchesFilter(item, 'difficult')).toBe(true)
    expect(matchesFilter({ ...item, states: [state('a', 'forward', { lapses: 2 })] }, 'difficult')).toBe(false)
  })

  it('learning includes relearning', () => {
    expect(matchesFilter({ card: card('a', 'a'), states: [state('a', 'forward', { state: 3 })] }, 'learning')).toBe(
      true,
    )
  })

  it('counts cards per filter', () => {
    const items = [
      { card: card('a', 'a'), states: [state('a', 'forward'), state('a', 'reverse', { state: 2 })] },
      { card: card('b', 'b'), states: [state('b', 'forward', { state: 1, lapses: 4 })] },
    ]
    expect(countByFilter(items)).toEqual({ new: 1, learning: 1, review: 1, difficult: 1 })
  })
})

describe('search', () => {
  const items = [
    { card: card('a', 'take off', { tags: ['phrasal'] }), states: [] },
    { card: card('b', 'run', { example: 'I Run  every morning' }), states: [] },
  ]

  it('finds a tag and an example substring', () => {
    expect(queryCards(items, { search: 'Phrasal', sort: 'alpha' }).map((i) => i.card.id)).toEqual(['a'])
    expect(queryCards(items, { search: 'run every', sort: 'alpha' }).map((i) => i.card.id)).toEqual(['b'])
  })

  it('filters by tag', () => {
    expect(queryCards(items, { tag: 'phrasal', sort: 'alpha' }).map((i) => i.card.id)).toEqual(['a'])
  })
})

describe('sort', () => {
  it('due_asc puts New cards last', () => {
    const items = [
      { card: card('new', 'n'), states: [state('new', 'forward')] },
      { card: card('late', 'l'), states: [state('late', 'forward', { state: 2, due: 500 })] },
      { card: card('soon', 's'), states: [state('soon', 'forward', { state: 2, due: 100 })] },
    ]
    expect(queryCards(items, { sort: 'due_asc' }).map((i) => i.card.id)).toEqual(['soon', 'late', 'new'])
  })

  it('sorts by date added, alphabet and difficulty', () => {
    const items = [
      { card: card('a', 'beta', { created_at: 1 }), states: [state('a', 'forward', { difficulty: 3 })] },
      { card: card('b', 'alpha', { created_at: 2 }), states: [state('b', 'forward', { difficulty: 8 })] },
    ]
    expect(queryCards(items, { sort: 'added_desc' }).map((i) => i.card.id)).toEqual(['b', 'a'])
    expect(queryCards(items, { sort: 'alpha' }).map((i) => i.card.id)).toEqual(['b', 'a'])
    expect(queryCards(items, { sort: 'difficulty_desc' }).map((i) => i.card.id)).toEqual(['b', 'a'])
  })
})
