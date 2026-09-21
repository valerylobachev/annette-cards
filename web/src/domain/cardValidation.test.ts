import { describe, expect, it } from 'vitest'
import { validateCardInput } from './cardValidation'

const base = { deck_id: 'd1', front: 'take off', back: 'взлетать' }

describe('validateCardInput', () => {
  it('requires front and back', () => {
    const { errors } = validateCardInput({ ...base, front: '  ', back: '' })
    expect(errors).toEqual([
      { field: 'front', code: 'required' },
      { field: 'back', code: 'required' },
    ])
  })

  it('rejects a front of 501 characters and notes of 2001 characters', () => {
    expect(validateCardInput({ ...base, front: 'a'.repeat(500) }).errors).toEqual([])
    expect(validateCardInput({ ...base, front: 'a'.repeat(501) }).errors).toEqual([
      { field: 'front', code: 'too_long', max: 500 },
    ])
    expect(validateCardInput({ ...base, notes: 'n'.repeat(2001) }).errors).toEqual([
      { field: 'notes', code: 'too_long', max: 2000 },
    ])
  })

  it('trims fields, turns empty optional fields into null and cleans tags', () => {
    const { value, errors } = validateCardInput({
      ...base,
      front: '  take off ',
      example: '   ',
      ipa: ' ˈteɪk ',
      tags: [' verbs ', '', 'Verbs', 'phrasal  verb'],
    })
    expect(errors).toEqual([])
    expect(value).toEqual({
      deck_id: 'd1',
      front: 'take off',
      back: 'взлетать',
      example: null,
      example_translation: null,
      ipa: 'ˈteɪk',
      tags: ['verbs', 'phrasal verb'],
      notes: null,
    })
  })
})
