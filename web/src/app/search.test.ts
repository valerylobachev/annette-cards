import { describe, expect, it } from 'vitest'
import { parseAuthSearch, parseStudySearch, parseSummarySearch } from './search'

describe('route search params', () => {
  it('parses the study deep link', () => {
    expect(parseStudySearch({ deck: 'd1', mode: 'typing' })).toEqual({ deck: 'd1', mode: 'typing' })
  })

  it('parses the practice flag', () => {
    expect(parseStudySearch({ deck: 'd1', practice: 1 })).toEqual({ deck: 'd1', practice: 1 })
    expect(parseStudySearch({ deck: 'd1', practice: 'yes' }).practice).toBeUndefined()
    expect(parseStudySearch({ repeat: 's1' })).toMatchObject({ practice: 1, repeat: 's1' })
  })

  it('drops unknown study modes and empty values', () => {
    expect(parseStudySearch({ deck: '', mode: 'flip' })).toEqual({ deck: undefined, mode: undefined })
  })

  it('parses the finished session of the summary', () => {
    expect(parseSummarySearch({ session: 's1' })).toEqual({ session: 's1' })
    expect(parseSummarySearch({})).toEqual({ session: undefined })
  })

  it('parses an invite code', () => {
    expect(parseAuthSearch({ invite: 'abc' })).toEqual({ invite: 'abc' })
    expect(parseAuthSearch({ invite: 42 })).toEqual({ invite: undefined })
  })
})
