import type { ReviewLog } from './types'

export type SessionSummary = {
  /** Distinct card directions answered. */
  cardsReviewed: number
  answers: number
  /** Share of Good and Easy answers, 0…1. */
  accuracy: number
  timeMs: number
  /** Cards that were New before their first answer in the session. */
  newLearned: number
  /** Cards answered Again at least once, in the order they were first failed ("Difficult in this session"). */
  difficultCardIds: string[]
}

/** Totals of one finished session (S-12) from its non-undone answers. */
export function summarizeSession(logs: ReviewLog[]): SessionSummary {
  const live = logs.filter((log) => log.deleted_at === null)
  const directions = new Set(live.map((log) => `${log.card_id}:${log.direction}`))
  const good = live.filter((log) => log.rating >= 3).length
  const learned = new Set(live.filter((log) => log.state_before.state === 0).map((log) => log.card_id))
  const difficult = new Set(live.filter((log) => log.rating === 1).map((log) => log.card_id))
  return {
    cardsReviewed: directions.size,
    answers: live.length,
    accuracy: live.length === 0 ? 0 : good / live.length,
    timeMs: live.reduce((sum, log) => sum + log.duration_ms, 0),
    newLearned: learned.size,
    difficultCardIds: [...difficult],
  }
}
