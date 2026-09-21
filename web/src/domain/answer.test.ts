import { describe, expect, it } from 'vitest'
import {
  answerLang,
  checkTypedAnswer,
  damerauLevenshtein,
  diffAnswer,
  ENGLISH_LEADING_WORDS,
  expectedAnswers,
  normalizeAnswer,
  stripDiacritics,
} from './answer'
import { typedRating } from './rating'

describe('normalizeAnswer', () => {
  const english = { ignoreLeading: ENGLISH_LEADING_WORDS }

  it('lowercases, collapses spaces, strips punctuation and one leading particle', () => {
    expect(normalizeAnswer('  To Take  Off! ', english)).toBe('take off')
    expect(normalizeAnswer('The house.', english)).toBe('house')
    expect(normalizeAnswer('«Дом»')).toBe('дом')
  })

  it('keeps leading articles unless asked to drop them', () => {
    expect(normalizeAnswer('The house.')).toBe('the house')
    expect(normalizeAnswer('a', english)).toBe('a')
  })

  it('treats composed and decomposed letters alike', () => {
    expect(normalizeAnswer('żółw'.normalize('NFD'))).toBe(normalizeAnswer('żółw'.normalize('NFC')))
  })
})

describe('stripDiacritics', () => {
  it('removes marks, including letters that do not decompose', () => {
    expect(stripDiacritics('żółw')).toBe('zolw')
    expect(stripDiacritics('łódź')).toBe('lodz')
    expect(stripDiacritics('Zażółć gęślą jaźń').toLowerCase()).toBe('zazolc gesla jazn')
    expect(stripDiacritics('Łøđ')).toBe('Lod')
  })
})

describe('damerauLevenshtein', () => {
  it.each([
    ['abc', 'abc', 0],
    ['abc', 'acb', 1],
    ['kitten', 'sitting', 3],
    ['', '', 0],
    ['', 'abc', 3],
    ['abc', '', 3],
  ])('%s → %s = %i', (a, b, distance) => {
    expect(damerauLevenshtein(a, b)).toBe(distance)
  })
})

describe('checkTypedAnswer', () => {
  it.each([
    ['house', 'house', 'exact'],
    ['house', 'hause', 'near'],
    ['house', 'huose', 'near'],
    ['house', 'hxxse', 'wrong'],
    ['beautiful', 'beatuiful', 'near'],
    ['beautiful', 'bxautifxl', 'near'],
    ['beautiful', 'beaxxxful', 'wrong'],
    ['to take off', 'Take off!', 'exact'],
  ])('expected %s, typed %s → %s', (expected, typed, verdict) => {
    expect(checkTypedAnswer([expected], typed, 'en-GB').verdict).toBe(verdict)
  })

  it('accepts missing diacritics as a near miss and marks them', () => {
    const result = checkTypedAnswer(['żółw'], 'zolw', 'pl-PL')
    expect(result.verdict).toBe('near')
    expect(result.diff).toEqual([
      { kind: 'diacritic', text: 'żół' },
      { kind: 'same', text: 'w' },
    ])
    expect(checkTypedAnswer(['gęś'], 'ges', 'pl-PL').verdict).toBe('near')
    expect(checkTypedAnswer(['żółw'], 'żółw', 'pl-PL').verdict).toBe('exact')
  })

  it('matches any meaning of the translation', () => {
    const expected = expectedAnswers({ front: 'take off', back: 'взлетать; снимать (одежду)' }, 'forward')
    expect(checkTypedAnswer(expected, 'взлетать', 'ru')).toEqual({
      verdict: 'exact',
      matched: 'взлетать',
      diff: [{ kind: 'same', text: 'взлетать' }],
    })
  })

  it('treats an empty answer as wrong', () => {
    expect(checkTypedAnswer(['house'], '  ', 'en')).toEqual({ verdict: 'wrong', matched: null, diff: [] })
  })

  it('keeps English articles for other languages', () => {
    expect(checkTypedAnswer(['a kot'], 'kot', 'pl').verdict).not.toBe('exact')
  })
})

describe('diffAnswer', () => {
  it('shows missing and extra letters', () => {
    expect(diffAnswer('house', 'hose')).toEqual([
      { kind: 'same', text: 'ho' },
      { kind: 'missing', text: 'u' },
      { kind: 'same', text: 'se' },
    ])
    expect(diffAnswer('house', 'houses')).toEqual([
      { kind: 'same', text: 'house' },
      { kind: 'extra', text: 's' },
    ])
    expect(diffAnswer('house', 'hause')).toEqual([
      { kind: 'same', text: 'h' },
      { kind: 'extra', text: 'a' },
      { kind: 'missing', text: 'o' },
      { kind: 'same', text: 'use' },
    ])
  })
})

describe('expectedAnswers', () => {
  const card = { front: 'take off', back: 'взлетать; снимать (одежду); ' }

  it('expects the studied word for reverse and any meaning for forward', () => {
    expect(expectedAnswers(card, 'reverse')).toEqual(['take off'])
    expect(expectedAnswers(card, 'forward')).toEqual(['взлетать', 'снимать (одежду)'])
  })

  it('types the answer in the language it is written in', () => {
    const deck = { target_lang: 'pl-PL', native_lang: 'ru' }
    expect(answerLang(deck, 'reverse')).toBe('pl-PL')
    expect(answerLang(deck, 'forward')).toBe('ru')
  })
})

describe('typedRating', () => {
  it('maps exact to Good, near to Hard and wrong (or "I don\'t know") to Again', () => {
    expect(typedRating('exact')).toBe(3)
    expect(typedRating('near')).toBe(2)
    expect(typedRating('wrong')).toBe(1)
  })
})
