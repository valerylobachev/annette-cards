import { buildStats, type Stats, type StatsPeriod } from '@/domain/stats'
import { db } from './schema'
import { getSettings } from './settings'

/**
 * The statistics of S-13 at `now` (read-only): every deck, card, state and answer of this device, computed by
 * `buildStats` for the period and the deck (`null` = all active decks).
 */
export async function loadStats(period: StatsPeriod, deckId: string | null, now: number): Promise<Stats> {
  const [decks, cards, states, logs, settings] = await Promise.all([
    db.decks.toArray(),
    db.cards.toArray(),
    db.card_states.toArray(),
    db.review_log.toArray(),
    getSettings(),
  ])
  return buildStats({ decks, cards, states, logs }, period, deckId, { now, dayStartHour: settings.day_start_hour })
}
