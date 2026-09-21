import { describe, expect, it } from 'vitest'
import { currentStreak, last7Days, longestStreak, studyDays } from '../streak'
import { studyDayOf } from '../studyDay'
import { log } from './fixtures'

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

describe('longestStreak', () => {
  it('finds the longest run over gaps', () => {
    expect(longestStreak(days('2026-09-01', '2026-09-02', '2026-09-03', '2026-09-10', '2026-09-11'))).toBe(3)
    expect(longestStreak(days())).toBe(0)
  })
})

describe('studyDays', () => {
  const at = (day: number, hour: number) => new Date(2026, 8, day, hour).getTime()

  it('counts practice answers but not undone ones', () => {
    const logs = [
      log('c1', at(19, 20), { practice: true }),
      log('c1', at(20, 20), { deleted_at: at(20, 21) }),
      log('c1', at(21, 20)),
    ]
    const studied = studyDays(logs, 4)
    expect([...studied].sort()).toEqual(['2026-09-19', '2026-09-21'])
    expect(currentStreak(studied, '2026-09-21')).toBe(1)
    expect(currentStreak(studyDays(logs.slice(0, 1), 4), '2026-09-20')).toBe(1)
  })

  it('starts the day at day_start_hour: 03:30 is the day before, 04:00 the day itself', () => {
    expect([...studyDays([log('c1', new Date(2026, 8, 21, 3, 30).getTime())], 4)]).toEqual(['2026-09-20'])
    expect([...studyDays([log('c1', new Date(2026, 8, 21, 4, 0).getTime())], 4)]).toEqual(['2026-09-21'])
  })

  it('reads the days in another zone without a fake gap after a move (Riga → Warsaw)', () => {
    // Evenings in Riga on the 19th and 20th, then an evening in Warsaw on the 21st.
    const riga = (day: number) => Date.parse(`2026-09-${day}T20:00:00+03:00`)
    const warsaw = Date.parse('2026-09-21T20:00:00+02:00')
    const logs = [log('c1', riga(19)), log('c1', riga(20)), log('c1', warsaw)]
    const inWarsaw = studyDays(logs, 4, 'Europe/Warsaw')
    expect([...inWarsaw].sort()).toEqual(['2026-09-19', '2026-09-20', '2026-09-21'])
    expect(currentStreak(inWarsaw, studyDayOf(warsaw, 4, 'Europe/Warsaw'))).toBe(3)
    // In a zone 9 hours east, 03:30 local of the next day falls before the boundary: still the same study day.
    expect(studyDayOf(Date.parse('2026-09-21T18:30:00Z'), 4, 'Asia/Tokyo')).toBe('2026-09-21')
  })
})
