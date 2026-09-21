import type { ReviewLog } from './types'

export type DailyCounters = {
  /** Answers to cards that were New before the answer. */
  newIntroduced: number
  /** All other answers (learning steps and reviews). */
  reviewsDone: number
}

/** Logs that count towards daily limits: not undone. */
export function countedLogs(logs: ReviewLog[]): ReviewLog[] {
  return logs.filter((log) => log.deleted_at === null)
}

/** Daily counters from the logs of one study day (the caller selects the day's logs). */
export function dailyCounters(logs: ReviewLog[]): DailyCounters {
  let newIntroduced = 0
  for (const log of countedLogs(logs)) if (log.state_before.state === 0) newIntroduced++
  return { newIntroduced, reviewsDone: countedLogs(logs).length - newIntroduced }
}
