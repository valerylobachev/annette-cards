import type { SyncStamp } from '../types'

/**
 * Last-write-wins (architecture.md §6.1): the incoming row replaces the stored one when its `updated_at` is larger;
 * on a tie the larger `updated_by` (device id, compared as a string) wins. An identical stamp is not a win, so
 * applying the same row twice is a no-op. The server uses the same rule (`server/src/sync/lww.rs`).
 */
export function incomingWins(incoming: SyncStamp, existing: SyncStamp): boolean {
  if (incoming.updated_at !== existing.updated_at) return incoming.updated_at > existing.updated_at
  return incoming.updated_by > existing.updated_by
}
