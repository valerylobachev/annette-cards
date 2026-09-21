import type { QueueItem } from './session'

const SECONDS_PER_REVIEW = 8
const SECONDS_PER_NEW = 15

/** Rough session length for Today (S-04 "≈ 9 min"): ≈ 8 s per review or learning step, 15 s per new card. */
export function estimateMinutes(queue: QueueItem[]): number {
  const seconds = queue.reduce((sum, item) => sum + (item.kind === 'new' ? SECONDS_PER_NEW : SECONDS_PER_REVIEW), 0)
  return Math.ceil(seconds / 60)
}
