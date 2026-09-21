import { useLiveQuery } from 'dexie-react-hooks'
import { loadStats } from '@/db/stats'
import type { StatsPeriod } from '@/domain/stats'
import { now } from '@/lib/clock'

/**
 * Live statistics for S-13; `undefined` only on the first load. After a filter change the previous numbers stay
 * until the new ones are computed, so the screen does not flash empty.
 */
export function useStatsData({ period, deckId }: { period: StatsPeriod; deckId: string | null }) {
  return useLiveQuery(() => loadStats(period, deckId, now()), [period, deckId])
}
