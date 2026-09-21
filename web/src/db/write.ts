import type { SyncStamp } from '@/domain/types'
import { now } from '@/lib/clock'
import { getDeviceId } from './device'
import { db, type TableName } from './schema'

/** Time and writer shared by every row changed in one transaction. */
export type WriteContext = { now: number; deviceId: string }

/** Sets the last-write-wins fields (`updated_at`, `updated_by`) on an entity. */
export function stamp<T extends object>(ctx: WriteContext, entity: T): T & SyncStamp {
  return { ...entity, updated_at: ctx.now, updated_by: ctx.deviceId }
}

/**
 * Runs `fn` in one `rw` transaction over `tables` plus `outbox` (architecture.md §4.3): validate → stamp → put →
 * outbox. If `fn` throws, every write in it is rolled back, including the outbox entries.
 */
export async function mutate<T>(tables: TableName[], fn: (ctx: WriteContext) => Promise<T>): Promise<T> {
  const deviceId = await getDeviceId()
  return db.transaction('rw', [...tables, 'outbox'], () => fn({ now: now(), deviceId }))
}
