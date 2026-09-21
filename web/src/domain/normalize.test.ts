import { describe, expect, it } from 'vitest'
import { normalizeFront } from './normalize'

describe('normalizeFront', () => {
  it('trims, lowercases and collapses whitespace', () => {
    expect(normalizeFront('  To  Take OFF ')).toBe('to take off')
    expect(normalizeFront('a\t\nb')).toBe('a b')
  })

  it('treats decomposed and composed characters as equal', () => {
    const decomposed = 'ż'
    const composed = 'ż'
    expect(decomposed).not.toBe(composed)
    expect(normalizeFront(decomposed)).toBe(normalizeFront(composed))
  })
})
