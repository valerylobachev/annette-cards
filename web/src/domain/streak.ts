import { addDays, format, parseISO } from 'date-fns'
import type { StudyDay } from './studyDay'

const shift = (day: StudyDay, days: number): StudyDay => format(addDays(parseISO(day), days), 'yyyy-MM-dd')

/**
 * Current streak in study days (decision D5, minimal version): consecutive days with at least one answer, ending
 * today, or yesterday when nothing was answered yet today (the streak is not lost until the day is over).
 */
export function currentStreak(studyDays: ReadonlySet<StudyDay>, today: StudyDay): number {
  let day = studyDays.has(today) ? today : shift(today, -1)
  let streak = 0
  while (studyDays.has(day)) {
    streak++
    day = shift(day, -1)
  }
  return streak
}

/** Whether each of the last 7 study days had an answer, oldest first, today last (the dots on Today). */
export function last7Days(studyDays: ReadonlySet<StudyDay>, today: StudyDay): boolean[] {
  return Array.from({ length: 7 }, (_, i) => studyDays.has(shift(today, i - 6)))
}
