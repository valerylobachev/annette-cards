import { describe, expect, it } from 'vitest'
import { choiceAvailable, choiceOptions, pickDistractors, shuffle } from '../distractors'
import { card, deck } from './fixtures'

/** A fixed sequence of "random" numbers, repeated. */
const sequence =
  (...values: number[]) =>
  () => {
    const value = values.shift() ?? 0.5
    values.push(value)
    return value
  }

const ids = (cards: { id: string }[]) => cards.map((c) => c.id).sort()

describe('pickDistractors', () => {
  const target = card('t', 'd1', { front: 'house', back: 'дом', tags: ['home'] })

  it('never offers the target or a value equal to the answer or to another option', () => {
    const pool = [
      target,
      card('same', 'd1', { front: ' House ' }),
      card('a', 'd1', { front: 'mouse' }),
      card('a2', 'd1', { front: 'MOUSE' }),
      card('b', 'd1', { front: 'horse' }),
      card('c', 'd1', { front: 'hose' }),
    ]
    const picked = pickDistractors(target, pool, 'front', 3, sequence(0.1, 0.9, 0.4))
    const fronts = picked.map((c) => c.front.toLowerCase())
    expect(fronts).not.toContain('house')
    expect(new Set(fronts).size).toBe(3)
    expect(picked.map((c) => c.id)).not.toContain('t')
  })

  it('prefers the same deck, then shared tags, then a similar length', () => {
    const pool = [
      card('other-deck', 'd2', { front: 'horse', tags: ['home'] }),
      card('tagged', 'd1', { front: 'a very long phrase indeed', tags: ['home'] }),
      card('close', 'd1', { front: 'mouse' }),
      card('far', 'd1', { front: 'extraordinarily' }),
      card('near', 'd1', { front: 'hose' }),
    ]
    expect(ids(pickDistractors(target, pool, 'front', 3, sequence(0.3)))).toEqual(['close', 'near', 'tagged'])
    expect(ids(pickDistractors(target, pool, 'front', 1, sequence(0.7)))).toEqual(['tagged'])
  })

  it('lets a similar length win over chance when tags are equal', () => {
    const pool = [card('long', 'd1', { front: 'extraordinarily' }), card('short', 'd1', { front: 'mouse' })]
    for (const seed of [0, 0.5, 0.99]) {
      expect(pickDistractors(target, pool, 'front', 1, sequence(seed)).map((c) => c.id)).toEqual(['short'])
    }
  })

  it('skips deleted cards and compares the requested field', () => {
    const pool = [
      card('deleted', 'd1', { back: 'кошка', deleted_at: 5 }),
      card('same-back', 'd1', { back: 'Дом' }),
      card('ok', 'd1', { back: 'кот' }),
    ]
    expect(ids(pickDistractors(target, pool, 'back'))).toEqual(['ok'])
  })

  it('returns fewer distractors when the pool has no more', () => {
    expect(pickDistractors(target, [target, card('a', 'd1')], 'front')).toHaveLength(1)
  })
})

describe('choiceOptions', () => {
  it('shuffles the answer among the distractors', () => {
    const target = card('t', 'd1', { back: 'дом' })
    const pool = ['кот', 'пёс', 'мышь'].map((back, i) => card(`c${i}`, 'd1', { back }))
    const options = choiceOptions(target, pool, 'back', sequence(0.2, 0.8, 0.5))
    expect(options).toHaveLength(4)
    expect(options.filter((option) => option.correct)).toEqual([{ text: 'дом', correct: true }])
  })

  it('shuffle keeps every item', () => {
    expect(shuffle([1, 2, 3, 4], sequence(0.9, 0.1)).sort()).toEqual([1, 2, 3, 4])
  })
})

describe('choiceAvailable', () => {
  const words = (deckId: string, fronts: string[]) =>
    fronts.map((front) => card(`${deckId}-${front}`, deckId, { front }))

  it('needs four different words in one studied language', () => {
    const en = deck('en')
    expect(choiceAvailable([en], words('en', ['a', 'b', 'c']))).toBe(false)
    expect(choiceAvailable([en], words('en', ['a', 'b', 'c', 'C']))).toBe(false)
    expect(choiceAvailable([en], words('en', ['a', 'b', 'c', 'd']))).toBe(true)
  })

  it('counts decks of the same language together, but not other languages or archived decks', () => {
    const cards = [...words('en1', ['a', 'b']), ...words('en2', ['c', 'd'])]
    expect(choiceAvailable([deck('en1'), deck('en2')], cards)).toBe(true)
    expect(choiceAvailable([deck('en1'), deck('en2', { target_lang: 'pl-PL' })], cards)).toBe(false)
    expect(choiceAvailable([deck('en1'), deck('en2', { archived_at: 1 })], cards)).toBe(false)
  })
})
