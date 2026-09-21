import { describe, expect, it } from 'vitest'
import { acceptAll, mergeSuggestions, type SuggestibleFields } from './enrich'

const EMPTY: SuggestibleFields = { back: '', example: '', example_translation: '', ipa: '', notes: '' }

describe('mergeSuggestions', () => {
  it('fills empty fields', () => {
    const merged = mergeSuggestions(EMPTY, { back: 'черепаха', ipa: '/ʐuf/' })
    expect(merged).toEqual({
      back: { value: '', suggestion: 'черепаха', status: 'empty-fill' },
      ipa: { value: '', suggestion: '/ʐuf/', status: 'empty-fill' },
    })
  })

  it('marks an identical value as same and a different one as a conflict', () => {
    const current = { ...EMPTY, back: ' черепаха ', notes: 'animal' }
    const merged = mergeSuggestions(current, { back: 'черепаха', notes: 'сущ., м. р.' })
    expect(merged.back?.status).toBe('same')
    expect(merged.notes).toEqual({ value: 'animal', suggestion: 'сущ., м. р.', status: 'conflict' })
  })

  it('skips fields without a suggestion', () => {
    const merged = mergeSuggestions(EMPTY, { back: 'кот', example: null, notes: '  ' })
    expect(Object.keys(merged)).toEqual(['back'])
  })
})

describe('acceptAll', () => {
  it('fills empty fields and leaves conflicts until confirmed', () => {
    const current = { ...EMPTY, back: 'черепашка', ipa: '/ʐuf/' }
    const suggestion = { back: 'черепаха', example: 'Żółw śpi.', ipa: '/ʐuf/' }
    const { fields, conflicts } = acceptAll(current, mergeSuggestions(current, suggestion))
    expect(fields).toEqual({ ...current, example: 'Żółw śpi.' })
    expect(conflicts).toEqual(['back'])
  })
})
