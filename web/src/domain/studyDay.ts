import { addDays, format, parseISO } from 'date-fns'

/** A study day as `YYYY-MM-DD` (local time). */
export type StudyDay = string

/** The device's IANA time zone (`Europe/Riga`). */
export function deviceTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}

const formatters = new Map<string, Intl.DateTimeFormat>()

/** Calendar date and hour of a moment in `timeZone`. */
function zonedDateHour(ms: number, timeZone: string): { date: StudyDay; hour: number } {
  let formatter = formatters.get(timeZone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
    })
    formatters.set(timeZone, formatter)
  }
  const parts = Object.fromEntries(formatter.formatToParts(new Date(ms)).map((part) => [part.type, part.value]))
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) }
}

/**
 * The study day a moment belongs to (architecture.md §4.4 "Day boundary"): a day starts at `dayStartHour` local
 * time, so 03:30 with `dayStartHour = 4` still belongs to the previous day. Uses local calendar fields, so DST
 * changes do not move the boundary. `timeZone` defaults to the device's; every moment is read in that one zone,
 * so days studied before a move to another zone keep their order and a nearby zone creates no gap.
 */
export function studyDayOf(ms: number, dayStartHour: number, timeZone?: string): StudyDay {
  if (timeZone !== undefined && timeZone !== deviceTimeZone()) {
    const { date, hour } = zonedDateHour(ms, timeZone)
    return hour < dayStartHour ? shiftDay(date, -1) : date
  }
  // Called for every answer by the statistics (100 000 and more): plain Date fields, no formatting library.
  const date = new Date(ms)
  if (date.getHours() < dayStartHour) date.setDate(date.getDate() - 1)
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

const pad2 = (value: number) => (value < 10 ? `0${value}` : `${value}`)

/** The study day `days` after `day` (negative: before). */
export function shiftDay(day: StudyDay, days: number): StudyDay {
  return format(addDays(parseISO(day), days), 'yyyy-MM-dd')
}

/** `[start, end)` of a study day in ms since the epoch. */
export function studyDayBounds(day: StudyDay, dayStartHour: number): [number, number] {
  const midnight = parseISO(day)
  const start = new Date(midnight.getFullYear(), midnight.getMonth(), midnight.getDate(), dayStartHour)
  const next = addDays(midnight, 1)
  const end = new Date(next.getFullYear(), next.getMonth(), next.getDate(), dayStartHour)
  return [start.getTime(), end.getTime()]
}
