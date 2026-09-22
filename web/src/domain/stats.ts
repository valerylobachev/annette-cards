import { eligibleStates } from './session'
import { currentStreak, longestStreak, studyDays } from './streak'
import { type StudyDay, shiftDay, studyDayOf } from './studyDay'
import type { Card, CardState, Deck, ReviewLog } from './types'

/** Review interval from which a card is mature (S-13); shorter Review intervals are young. */
export const MATURE_DAYS = 21
/** Days of the due forecast (S-13). */
export const FORECAST_DAYS = 30
/** Periods of the statistics screen, in study days. */
export const STATS_PERIODS = [7, 30, 365] as const
export type StatsPeriod = (typeof STATS_PERIODS)[number]

/** Where "now" is: study days start at `dayStartHour` in `timeZone` (device zone when omitted). */
export type StatsClock = { now: number; dayStartHour: number; timeZone?: string }

const dayOf = (ms: number, clock: StatsClock) => studyDayOf(ms, clock.dayStartHour, clock.timeZone)

/** The last `count` study days, oldest first, today last. */
export function periodDays(count: number, clock: StatsClock): StudyDay[] {
  const today = dayOf(clock.now, clock)
  return Array.from({ length: count }, (_, i) => shiftDay(today, i - count + 1))
}

type Log = Pick<ReviewLog, 'reviewed_at' | 'rating' | 'duration_ms' | 'state_before' | 'practice' | 'deleted_at'>

/** Logs grouped by study day; undone (soft-deleted) logs are left out. */
function logsByDay<T extends Log>(logs: T[], clock: StatsClock): Map<StudyDay, T[]> {
  const byDay = new Map<StudyDay, T[]>()
  for (const log of logs) {
    if (log.deleted_at !== null) continue
    const day = dayOf(log.reviewed_at, clock)
    const list = byDay.get(day)
    if (list) list.push(log)
    else byDay.set(day, [log])
  }
  return byDay
}

export type ReviewsOnDay = { day: StudyDay; again: number; hard: number; good: number; easy: number }

/** Answers per study day stacked by rating (practice answers included: they are reviews too). */
export function reviewsPerDay(logs: Log[], days: StudyDay[], clock: StatsClock): ReviewsOnDay[] {
  return reviewsOnDays(logsByDay(logs, clock), days)
}

function reviewsOnDays(byDay: Map<StudyDay, Log[]>, days: StudyDay[]): ReviewsOnDay[] {
  return days.map((day) => {
    const counts = { day, again: 0, hard: 0, good: 0, easy: 0 }
    for (const log of byDay.get(day) ?? []) {
      if (log.rating === 1) counts.again++
      else if (log.rating === 2) counts.hard++
      else if (log.rating === 3) counts.good++
      else counts.easy++
    }
    return counts
  })
}

/** Minutes spent answering per study day (`duration_ms`, capped at 60 s per answer when logged). */
export function timePerDay(logs: Log[], days: StudyDay[], clock: StatsClock): { day: StudyDay; minutes: number }[] {
  return timeOnDays(logsByDay(logs, clock), days)
}

function timeOnDays(byDay: Map<StudyDay, Log[]>, days: StudyDay[]): { day: StudyDay; minutes: number }[] {
  return days.map((day) => {
    const ms = (byDay.get(day) ?? []).reduce((sum, log) => sum + log.duration_ms, 0)
    return { day, minutes: Math.round(ms / 6_000) / 10 }
  })
}

/**
 * Share of Good and Easy answers to cards in the Review state (`state_before`), `null` without such answers.
 * Practice answers (decision D2) and undone ones are left out.
 */
export function retention(logs: Log[]): number | null {
  const reviews = logs.filter((log) => log.deleted_at === null && !log.practice && log.state_before.state === 2)
  if (reviews.length === 0) return null
  return reviews.filter((log) => log.rating >= 3).length / reviews.length
}

/** `retention` per study day. */
export function retentionPerDay(
  logs: Log[],
  days: StudyDay[],
  clock: StatsClock,
): { day: StudyDay; retention: number | null }[] {
  return retentionOnDays(logsByDay(logs, clock), days)
}

function retentionOnDays(byDay: Map<StudyDay, Log[]>, days: StudyDay[]): { day: StudyDay; retention: number | null }[] {
  return days.map((day) => ({ day, retention: retention(byDay.get(day) ?? []) }))
}

/** Studied states (not New) due on each of the next `days` study days; overdue ones count on today. */
export function dueForecast(
  states: CardState[],
  clock: StatsClock,
  days = FORECAST_DAYS,
): { day: StudyDay; count: number }[] {
  const today = dayOf(clock.now, clock)
  const forecast = Array.from({ length: days }, (_, i) => ({ day: shiftDay(today, i), count: 0 }))
  const index = new Map(forecast.map((entry, i) => [entry.day, i]))
  for (const state of states) {
    if (state.deleted_at !== null || state.state === 0) continue
    const i = state.due <= clock.now ? 0 : index.get(dayOf(state.due, clock))
    const entry = i === undefined ? undefined : forecast[i]
    if (entry) entry.count++
  }
  return forecast
}

export type StateDistribution = { new: number; learning: number; young: number; mature: number }

/** Studied directions by state: Learning and Relearning together; Review split at `MATURE_DAYS`. */
export function stateDistribution(states: CardState[]): StateDistribution {
  const distribution: StateDistribution = { new: 0, learning: 0, young: 0, mature: 0 }
  for (const state of states) {
    if (state.deleted_at !== null) continue
    if (state.state === 0) distribution.new++
    else if (state.state === 2) distribution[state.scheduled_days >= MATURE_DAYS ? 'mature' : 'young']++
    else distribution.learning++
  }
  return distribution
}

export type Kpis = { totalCards: number; matureCards: number; currentStreak: number; longestStreak: number }

/**
 * Tiles of S-13: cards, mature cards (every studied direction of the card is mature), and the streaks, which count
 * every answer on any deck, like Today.
 */
export function kpis(cards: Card[], states: CardState[], allLogs: Log[], clock: StatsClock): Kpis {
  return kpisOfDays(cards, states, studyDays(allLogs, clock.dayStartHour, clock.timeZone), clock)
}

function kpisOfDays(cards: Card[], states: CardState[], days: ReadonlySet<StudyDay>, clock: StatsClock): Kpis {
  const statesByCard = new Map<string, CardState[]>()
  for (const state of states) {
    if (state.deleted_at !== null) continue
    const list = statesByCard.get(state.card_id)
    if (list) list.push(state)
    else statesByCard.set(state.card_id, [state])
  }
  const mature = cards.filter((card) => {
    const cardStates = statesByCard.get(card.id) ?? []
    return cardStates.length > 0 && cardStates.every((s) => s.state === 2 && s.scheduled_days >= MATURE_DAYS)
  })
  return {
    totalCards: cards.length,
    matureCards: mature.length,
    currentStreak: currentStreak(days, dayOf(clock.now, clock)),
    longestStreak: longestStreak(days),
  }
}

/** Heatmap cell intensity from the answers of a day: 0 none, then 1–10, 11–30, 31–60, more. */
export function heatLevel(count: number): 0 | 1 | 2 | 3 | 4 {
  if (count === 0) return 0
  if (count <= 10) return 1
  if (count <= 30) return 2
  return count <= 60 ? 3 : 4
}

export type StatsInput = { decks: Deck[]; cards: Card[]; states: CardState[]; logs: ReviewLog[] }

export type Stats = {
  days: StudyDay[]
  reviews: ReviewsOnDay[]
  time: { day: StudyDay; minutes: number }[]
  retention: { day: StudyDay; retention: number | null }[]
  /** Retention over the whole period. */
  periodRetention: number | null
  forecast: { day: StudyDay; count: number }[]
  states: StateDistribution
  kpis: Kpis
  /** Answers per study day of the last year (the heatmap). */
  year: { day: StudyDay; count: number }[]
  /** Answers in the period. */
  total: number
  /** Any answer was ever given, on any deck (otherwise S-13 shows its empty state). */
  hasHistory: boolean
}

/**
 * Everything S-13 shows (UC-19). The statistics cover the active decks (not deleted, not archived; `deckId` narrows
 * them to one) like the study queue: states in the deck's active directions, and the answers to their cards, a
 * deleted card's history included. Streaks count every answer (`kpis`).
 */
export function buildStats(input: StatsInput, period: StatsPeriod, deckId: string | null, clock: StatsClock): Stats {
  const { cardById, eligible } = eligibleStates({ ...input, deckFilter: deckId ?? undefined })
  const liveDecks = new Set(
    input.decks
      .filter((deck) => deck.deleted_at === null && deck.archived_at === null)
      .filter((deck) => deckId === null || deck.id === deckId)
      .map((deck) => deck.id),
  )
  const deckOfCard = new Map(input.cards.map((card) => [card.id, card.deck_id]))
  const inLiveDeck = (log: Log & { card_id: string }) => {
    const deck = deckOfCard.get(log.card_id)
    return deck !== undefined && liveDecks.has(deck)
  }

  // Each answer's study day is computed once (100 000 answers take tens of ms): the streaks use every answer, the
  // series below only the answers of the active decks, looked up by day.
  const allByDay = logsByDay(input.logs, clock)
  const byDay = new Map<StudyDay, ReviewLog[]>()
  for (const [day, list] of allByDay) {
    const live = list.filter(inLiveDeck)
    if (live.length > 0) byDay.set(day, live)
  }
  const days = periodDays(period, clock)
  const reviews = reviewsOnDays(byDay, days)
  const year = reviewsOnDays(byDay, periodDays(365, clock)).map(({ day, again, hard, good, easy }) => ({
    day,
    count: again + hard + good + easy,
  }))
  return {
    days,
    reviews,
    time: timeOnDays(byDay, days),
    retention: retentionOnDays(byDay, days),
    periodRetention: retention(days.flatMap((day) => byDay.get(day) ?? [])),
    forecast: dueForecast(eligible, clock),
    states: stateDistribution(eligible),
    kpis: kpisOfDays([...cardById.values()], eligible, new Set(allByDay.keys()), clock),
    year,
    total: reviews.reduce((sum, day) => sum + day.again + day.hard + day.good + day.easy, 0),
    hasHistory: input.logs.some((log) => log.deleted_at === null),
  }
}
