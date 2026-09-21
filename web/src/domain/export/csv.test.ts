import { describe, expect, it } from 'vitest'
import { autoMap } from '../import/mapping'
import { parseDelimited } from '../import/parse'
import { validateRows } from '../import/validate'
import type { Card } from '../types'
import { deckCsvFilename, deckToCsv } from './csv'

function card(fields: Partial<Card>): Card {
  return {
    id: 'c',
    deck_id: 'd',
    front: '',
    back: '',
    example: null,
    example_translation: null,
    ipa: null,
    tags: [],
    notes: null,
    audio_id: null,
    created_at: 1,
    updated_at: 1,
    updated_by: 'x',
    deleted_at: null,
    ...fields,
  }
}

describe('deckToCsv', () => {
  it('round-trips through the import parser, including commas, quotes and newlines', () => {
    const cards = [
      card({
        front: 'to take off',
        back: 'взлетать; снимать (одежду)',
        example: 'He said "go", then left.',
        example_translation: 'Он сказал «иди»,\nи ушёл.',
        ipa: '/teɪk ɒf/',
        tags: ['travel', 'phrasal-verb'],
        notes: 'took/taken',
      }),
      card({ front: 'cat', back: 'кошка' }),
    ]
    const table = parseDelimited(deckToCsv(cards))
    expect(table.hasHeaderGuess).toBe(true)
    const [header = [], ...rows] = table.rows
    const parsed = validateRows(rows, autoMap(header), [])
    expect(parsed.map((row) => (row.status === 'ready' ? row.card : row))).toEqual([
      {
        front: 'to take off',
        back: 'взлетать; снимать (одежду)',
        example: 'He said "go", then left.',
        example_translation: 'Он сказал «иди»,\nи ушёл.',
        ipa: '/teɪk ɒf/',
        tags: ['travel', 'phrasal-verb'],
        notes: 'took/taken',
      },
      { front: 'cat', back: 'кошка', example: null, example_translation: null, ipa: null, tags: [], notes: null },
    ])
  })

  it('writes a header even for an empty deck', () => {
    expect(deckToCsv([])).toBe('front,back,example,example_translation,ipa,tags,notes\r\n')
  })
})

describe('deckCsvFilename', () => {
  it('replaces characters that file systems reject', () => {
    expect(deckCsvFilename('English: B2/C1', new Date(2026, 8, 21))).toBe('English_ B2_C1-2026-09-21.csv')
  })
})
