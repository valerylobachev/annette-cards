import { describe, expect, it } from 'vitest'
import { parseAuthSearch, parseStudySearch } from './search'

describe('route search params', () => {
  it('parses the study deep link', () => {
    expect(parseStudySearch({ deck: 'd1', mode: 'typing' })).toEqual({ deck: 'd1', mode: 'typing' })
  })

  it('drops unknown study modes and empty values', () => {
    expect(parseStudySearch({ deck: '', mode: 'flip' })).toEqual({ deck: undefined, mode: undefined })
  })

  it('parses an invite code', () => {
    expect(parseAuthSearch({ invite: 'abc' })).toEqual({ invite: 'abc' })
    expect(parseAuthSearch({ invite: 42 })).toEqual({ invite: undefined })
  })
})
