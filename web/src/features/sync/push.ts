import { push } from '@/api/endpoints/sync/sync'
import type { Rejected } from '@/api/model'
import { getDeviceId } from '@/db/device'
import { clearSentEntries, type OutboxRow, readOutboxRows } from '@/db/remote'
import { callApi } from '@/lib/api'
import { ENTITY_ORDER, pushChanges } from './convert'

/** Rows per push request (the server accepts at most 500). */
export const PUSH_BATCH = 500

export type PushResult = { pushed: number; rejected: Rejected[]; serverTime: number | null }

/**
 * Splits outbox rows into requests of at most `PUSH_BATCH` rows, parents first (decks → cards → card states →
 * review log → settings): a card whose deck was edited after it sits later in the outbox, and must not reach the
 * server before its deck.
 */
export function pushBatches(rows: OutboxRow[], size = PUSH_BATCH): OutboxRow[][] {
  const ordered = [...rows].sort((a, b) => ENTITY_ORDER.indexOf(a.entity) - ENTITY_ORDER.indexOf(b.entity))
  const batches: OutboxRow[][] = []
  for (let start = 0; start < ordered.length; start += size) batches.push(ordered.slice(start, start + size))
  return batches
}

/**
 * Pushes the whole outbox in batches. After each answer the sent entries leave the outbox: applied and skipped rows
 * are on the server (a skipped row comes back on pull), rejected ones would be refused again and are reported
 * instead. At least one request is made, even with an empty outbox, to read the server clock.
 */
export async function pushOutbox(onProgress?: (pushed: number, total: number) => void): Promise<PushResult> {
  const device_id = await getDeviceId()
  const batches = pushBatches(await readOutboxRows())
  const total = batches.reduce((sum, batch) => sum + batch.length, 0)
  let sent = 0
  const result: PushResult = { pushed: 0, rejected: [], serverTime: null }
  for (const batch of batches.length > 0 ? batches : [[]]) {
    const response = await callApi(() => push({ device_id, changes: pushChanges(batch) }))
    await clearSentEntries(batch.map((item) => item.entry))
    result.pushed += batch.length - response.rejected.length
    result.rejected.push(...response.rejected)
    result.serverTime = response.server_time
    sent += batch.length
    onProgress?.(sent, total)
  }
  return result
}
