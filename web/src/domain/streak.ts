import { type StudyDay, shiftDay, studyDayOf } from './studyDay'
import type { ReviewLog } from './types'

/**
 * Study days with at least one answer (decision D5): every non-undone log counts, practice included, whatever the
 * deck or card. Days are read in one time zone (`studyDayOf`).
 */
export function studyDays(
  logs: Pick<ReviewLog, 'reviewed_at' | 'deleted_at'>[],
  dayStartHour: number,
  timeZone?: string,
): Set<StudyDay> {
  return new Set(
    logs.filter((log) => log.deleted_at === null).map((log) => studyDayOf(log.reviewed_at, dayStartHour, timeZone)),
  )
}

/**
 * Current streak in study days: consecutive days with at least one answer, ending today, or yesterday when nothing
 * was answered yet today (the streak is not lost until the day is over).
 */
export function currentStreak(days: ReadonlySet<StudyDay>, today: StudyDay): number {
  let day = days.has(today) ? today : shiftDay(today, -1)
  let streak = 0
  while (days.has(day)) {
    streak++
    day = shiftDay(day, -1)
  }
  return streak
}

/** The longest run of consecutive study days ever. */
export function longestStreak(days: ReadonlySet<StudyDay>): number {
  let longest = 0
  for (const day of days) {
    // Count only from the first day of each run.
    if (days.has(shiftDay(day, -1))) continue
    let length = 1
    while (days.has(shiftDay(day, length))) length++
    longest = Math.max(longest, length)
  }
  return longest
}

/** Whether each of the last 7 study days had an answer, oldest first, today last (the dots on Today). */
export function last7Days(days: ReadonlySet<StudyDay>, today: StudyDay): boolean[] {
  return Array.from({ length: 7 }, (_, i) => days.has(shiftDay(today, i - 6)))
}
