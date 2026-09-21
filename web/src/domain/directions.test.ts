import { describe, expect, it } from 'vitest'
import { activeDirections, newCardState } from './directions'

describe('activeDirections', () => {
  it('maps the deck setting to directions', () => {
    expect(activeDirections('both')).toEqual(['forward', 'reverse'])
    expect(activeDirections('forward')).toEqual(['forward'])
    expect(activeDirections('reverse')).toEqual(['reverse'])
  })
})

describe('newCardState', () => {
  it('is a New state due now with zero counters', () => {
    expect(newCardState('c1', 'reverse', 1_000)).toMatchObject({
      card_id: 'c1',
      direction: 'reverse',
      state: 0,
      due: 1_000,
      stability: 0,
      difficulty: 0,
      reps: 0,
      lapses: 0,
      last_review: null,
      deleted_at: null,
    })
  })
})
