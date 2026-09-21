import { describe, expect, it } from 'vitest'
import { autoMap, defaultMapping, type ImportField } from './mapping'
import { parseDelimited } from './parse'
import { decodeUtf8, isValidUtf8 } from './utf8'
import { errorReportCsv, splitTags, summarize, validateRows } from './validate'

const README_CSV = `front,back,example,example_translation,ipa,tags,notes
to take off,взлетать; снимать (одежду),The plane took off at 6 am.,Самолёт взлетел в 6 утра.,/teɪk ɒf/,travel phrasal-verb,took/taken
`

describe('decodeUtf8', () => {
  it('accepts UTF-8 and strips the BOM', () => {
    const bytes = new TextEncoder().encode('﻿слово,перевод')
    expect(decodeUtf8(bytes)).toBe('слово,перевод')
  })

  it('rejects a Windows-1251 file', () => {
    // "слово" in Windows-1251.
    const cp1251 = new Uint8Array([0xf1, 0xeb, 0xee, 0xe2, 0xee, 0x2c, 0x61])
    expect(isValidUtf8(cp1251)).toBe(false)
    expect(decodeUtf8(cp1251)).toBeNull()
  })
})

describe('parseDelimited', () => {
  it('parses the README example into all seven fields', () => {
    const table = parseDelimited(README_CSV)
    expect(table.delimiter).toBe(',')
    expect(table.hasHeaderGuess).toBe(true)
    const [header, row] = table.rows
    const mapping = autoMap(header ?? [])
    expect(mapping).toEqual(['front', 'back', 'example', 'example_translation', 'ipa', 'tags', 'notes'])
    const [validated] = validateRows([row ?? []], mapping, [])
    expect(validated).toEqual({
      row: 1,
      status: 'ready',
      card: {
        front: 'to take off',
        back: 'взлетать; снимать (одежду)',
        example: 'The plane took off at 6 am.',
        example_translation: 'Самолёт взлетел в 6 утра.',
        ipa: '/teɪk ɒf/',
        tags: ['travel', 'phrasal-verb'],
        notes: 'took/taken',
      },
    })
  })

  it('detects semicolon and tab delimiters', () => {
    expect(parseDelimited('word;translation\ncat;кошка\n').delimiter).toBe(';')
    const tsv = parseDelimited('word\ttranslation\ncat, pet\tкошка\n')
    expect(tsv.delimiter).toBe('\t')
    expect(tsv.rows[1]).toEqual(['cat, pet', 'кошка'])
  })

  it('keeps a quoted field with a comma and a newline', () => {
    const table = parseDelimited('front,back\n"one, two","line 1\nline 2"\n')
    expect(table.rows[1]).toEqual(['one, two', 'line 1\nline 2'])
  })

  it('skips empty lines and pads short rows', () => {
    const table = parseDelimited('a,b,c\n\nd\n')
    expect(table.rows).toEqual([
      ['a', 'b', 'c'],
      ['d', '', ''],
    ])
    expect(table.hasHeaderGuess).toBe(false)
  })
})

describe('autoMap', () => {
  it('maps Russian headers', () => {
    expect(autoMap(['Слово', 'Перевод', 'Пример'])).toEqual(['front', 'back', 'example'])
  })

  it('maps English synonyms case-insensitively and ignores unknown or repeated headers', () => {
    expect(autoMap(['Term', 'MEANING', 'Level', 'word', ' Transcription '])).toEqual([
      'front',
      'back',
      'ignore',
      'ignore',
      'ipa',
    ])
  })

  it('maps the first two columns without a header', () => {
    expect(defaultMapping(3)).toEqual(['front', 'back', 'ignore'])
  })
})

describe('validateRows', () => {
  const mapping: ImportField[] = ['front', 'back']

  it('reports a missing translation with the 1-based data row number', () => {
    const rows = validateRows(
      [
        ['cat', 'кошка'],
        ['dog', ''],
      ],
      mapping,
      [],
    )
    expect(rows[1]).toEqual({ row: 2, status: 'error', errors: [{ code: 'missing_back' }] })
  })

  it('finds duplicates within the file and against the deck', () => {
    const rows = validateRows(
      [
        ['Cat', 'кошка'],
        ['  cat ', 'кот'],
        ['dog', 'собака'],
      ],
      mapping,
      ['dog'],
    )
    expect(rows.map((row) => (row.status === 'duplicate' ? `${row.status}:${row.of}` : row.status))).toEqual([
      'ready',
      'duplicate:file',
      'duplicate:deck',
    ])
    expect(summarize(rows)).toEqual({ ready: 1, duplicates: 2, errors: 0 })
  })

  it('rejects a 501-character front', () => {
    const [row] = validateRows([['x'.repeat(501), 'y']], mapping, [])
    expect(row).toEqual({ row: 1, status: 'error', errors: [{ code: 'too_long', field: 'front', max: 500 }] })
  })

  it('leaves unmapped optional fields out and turns blank mapped cells into null', () => {
    const [row] = validateRows([['cat', 'кошка', '']], ['front', 'back', 'example'], [])
    expect(row).toEqual({ row: 1, status: 'ready', card: { front: 'cat', back: 'кошка', example: null } })
  })

  it('writes an error report as CSV', () => {
    const rows = validateRows(
      [
        ['', ''],
        ['ok', 'ок'],
      ],
      mapping,
      [],
    )
    const csv = errorReportCsv(rows, ['row', 'reason'], (error) =>
      error.code === 'missing_front' ? 'no word, sorry' : error.code,
    )
    expect(csv).toBe('row,reason\r\n1,"no word, sorry"\r\n1,missing_back\r\n')
  })
})

describe('splitTags', () => {
  it('splits by spaces and semicolons', () => {
    expect(splitTags(' travel;verbs  b2 ;')).toEqual(['travel', 'verbs', 'b2'])
  })
})
