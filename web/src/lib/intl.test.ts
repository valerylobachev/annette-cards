import { describe, expect, it } from 'vitest'
import { formatDuration, formatNumber, formatPercent, languageName, relativeTime } from './intl'

const day = 24 * 3600 * 1000

describe('languageName', () => {
  it('names a language in the UI language', () => {
    expect(languageName('pl', 'ru')).toBe('польский')
    expect(languageName('pl', 'en')).toBe('Polish')
  })

  it('falls back to the code for an invalid tag', () => {
    expect(languageName('!!', 'en')).toBe('!!')
  })
})

describe('relativeTime', () => {
  it('formats future and past times', () => {
    expect(relativeTime(3 * day, 'en', 0)).toBe('in 3 days')
    expect(relativeTime(3 * day, 'ru', 0)).toBe('через 3 дня')
    expect(relativeTime(-2 * 3600 * 1000, 'en', 0)).toBe('2 hours ago')
    expect(relativeTime(10_000, 'en', 0)).toBe('this minute')
  })
})

describe('formatNumber', () => {
  it('uses locale grouping', () => {
    expect(formatNumber(1210, 'en')).toBe('1,210')
    expect(formatNumber(1210, 'ru')).toBe('1 210')
  })
})

describe('formatDuration and formatPercent', () => {
  it('shows minutes, or seconds below a minute', () => {
    expect(formatDuration(45_000, 'en')).toBe('45 sec')
    expect(formatDuration(260_000, 'en')).toBe('4 min')
    expect(formatDuration(260_000, 'ru')).toBe('4 мин')
  })

  it('shows a whole percentage', () => {
    expect(formatPercent(0.75, 'en')).toBe('75%')
    expect(formatPercent(0.75, 'ru')).toBe('75\u00a0%')
  })
})
