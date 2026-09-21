import { addDays, format, parseISO, startOfDay, subDays } from 'date-fns'

/** A study day as `YYYY-MM-DD` (local time). */
export type StudyDay = string

/**
 * The study day a moment belongs to (architecture.md §4.4 "Day boundary"): a day starts at `dayStartHour` local
 * time, so 03:30 with `dayStartHour = 4` still belongs to the previous day. Uses local calendar fields, so DST
 * changes do not move the boundary.
 */
export function studyDayOf(ms: number, dayStartHour: number): StudyDay {
  const date = new Date(ms)
  const day = date.getHours() < dayStartHour ? subDays(startOfDay(date), 1) : startOfDay(date)
  return format(day, 'yyyy-MM-dd')
}

/** `[start, end)` of a study day in ms since the epoch. */
export function studyDayBounds(day: StudyDay, dayStartHour: number): [number, number] {
  const midnight = parseISO(day)
  const start = new Date(midnight.getFullYear(), midnight.getMonth(), midnight.getDate(), dayStartHour)
  const next = addDays(midnight, 1)
  const end = new Date(next.getFullYear(), next.getMonth(), next.getDate(), dayStartHour)
  return [start.getTime(), end.getTime()]
}
