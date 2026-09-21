import { buildPracticeQueue } from '@/domain/practice'
import { buildSession, type QueueItem, type SessionInput } from '@/domain/session'
import { type StudyDay, studyDayBounds, studyDayOf } from '@/domain/studyDay'
import { getMeta, setMeta } from './meta'
import { db } from './schema'
import { getSettings } from './settings'

/** How many extra new cards one "Learn extra new words" tap allows (S-04, UC-08 1a). */
export const EXTRA_NEW_STEP = 10

/** The extra-new allowance of a study day; 0 when it was granted on another day. */
export async function getExtraNew(day: StudyDay): Promise<number> {
  const stored = await getMeta('extra_new')
  return stored?.study_day === day ? stored.count : 0
}

/** Raises today's new-card limit by `count`; a new study day starts from 0. Device-local, never outboxed. */
export async function addExtraNew(now: number, count = EXTRA_NEW_STEP): Promise<number> {
  const { day_start_hour } = await getSettings()
  const day = studyDayOf(now, day_start_hour)
  const total = (await getExtraNew(day)) + count
  await setMeta('extra_new', { study_day: day, count: total })
  return total
}

/** Everything `buildSession` needs, read from the local database at `now`. */
export async function loadSessionInput(now: number, deckFilter?: string): Promise<SessionInput> {
  const settings = await getSettings()
  const day = studyDayOf(now, settings.day_start_hour)
  const [start, end] = studyDayBounds(day, settings.day_start_hour)
  const [decks, cards, states, logsToday, extraNew] = await Promise.all([
    db.decks.toArray(),
    db.cards.toArray(),
    db.card_states.toArray(),
    db.review_log.where('reviewed_at').between(start, end, true, false).toArray(),
    getExtraNew(day),
  ])
  return { decks, cards, states, logsToday, settings, extraNew, deckFilter }
}

export async function loadSession(now: number, deckFilter?: string): Promise<QueueItem[]> {
  return buildSession(await loadSessionInput(now, deckFilter), now)
}

/** Practice queue (UC-16) for all decks or one deck; `failedIds` = cards failed in the last session. */
export async function loadPracticeQueue(deckFilter?: string, failedIds?: string[]): Promise<QueueItem[]> {
  const [decks, cards, states] = await Promise.all([db.decks.toArray(), db.cards.toArray(), db.card_states.toArray()])
  return buildPracticeQueue({ decks, cards, states, deckFilter, failedIds })
}
