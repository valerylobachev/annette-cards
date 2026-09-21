import { describe, expect, it } from 'vitest'
import { currentStreak, last7Days } from '../streak'
import { studyDayOf } from '../studyDay'

const days = (...list: string[]) => new Set(list)
const run = (last: string, count: number) =>
  Array.from({ length: count }, (_, i) => {
    const date = new Date(last)
    date.setDate(date.getDate() - i)
    return date.toISOString().slice(0, 10)
  })

describe('currentStreak', () => {
  it('counts today and the 11 days before it as 12', () => {
    expect(currentStreak(new Set(run('2026-09-21', 12)), '2026-09-21')).toBe(12)
  })

  it('restarts at 1 after a gap yesterday', () => {
    expect(currentStreak(days('2026-09-21', '2026-09-19', '2026-09-18'), '2026-09-21')).toBe(1)
  })

  it('keeps the streak when nothing was studied yet today', () => {
    expect(currentStreak(days('2026-09-20', '2026-09-19'), '2026-09-21')).toBe(2)
    expect(currentStreak(days('2026-09-19'), '2026-09-21')).toBe(0)
  })

  it('uses study days, so a review at 03:30 belongs to the day before', () => {
    const lateNight = new Date(2026, 8, 21, 3, 30).getTime()
    const studied = days(studyDayOf(lateNight, 4), '2026-09-19')
    expect(currentStreak(studied, '2026-09-20')).toBe(2)
    expect(currentStreak(days(studyDayOf(lateNight, 0), '2026-09-19'), '2026-09-20')).toBe(1)
  })

  it('crosses month ends', () => {
    expect(currentStreak(days('2026-10-01', '2026-09-30'), '2026-10-01')).toBe(2)
  })
})

describe('last7Days', () => {
  it('marks the studied days of the last week, today last', () => {
    expect(last7Days(days('2026-09-21', '2026-09-19', '2026-09-15', '2026-09-14'), '2026-09-21')).toEqual([
      true,
      false,
      false,
      false,
      true,
      false,
      true,
    ])
  })
})
