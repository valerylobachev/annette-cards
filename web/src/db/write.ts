import type { Transaction } from 'dexie'
import type { SyncStamp } from '@/domain/types'
import { now } from '@/lib/clock'
import { notifyLocalChange } from './changes'
import { getDeviceId } from './device'
import { type AnnetteDb, db, type TableName } from './schema'

/** The tables of one transaction. Operations on them always run in that transaction. */
export type TxTables = Pick<AnnetteDb, TableName>

/**
 * One write transaction: its tables, the writer, the time of the change (`now`: review times, `deleted_at`, due
 * dates) and the last-write-wins stamp time (`stampAt`: `now`, moved just past this device's previous stamp if
 * needed).
 */
export type WriteContext = { db: TxTables; now: number; stampAt: number; deviceId: string }

/** Sets the last-write-wins fields (`updated_at`, `updated_by`) on an entity. */
export function stamp<T extends object>(ctx: WriteContext, entity: T): T & SyncStamp {
  return { ...entity, updated_at: ctx.stampAt, updated_by: ctx.deviceId }
}

const tableNames: TableName[] = ['decks', 'cards', 'card_states', 'review_log', 'settings', 'outbox', 'meta']

// Tables taken from the transaction object instead of the global `db`. Dexie tracks the current transaction
// through async calls implicitly, but that tracking can be lost in deep chains of nested async functions, and a
// write outside the transaction would break atomicity. Bound tables make the transaction explicit.
function bindTables(tx: Transaction): TxTables {
  const tables = {} as Record<TableName, unknown>
  for (const name of tableNames) Object.defineProperty(tables, name, { get: () => tx.table(name) })
  return tables as TxTables
}

/**
 * Runs `fn` in one `rw` transaction over `tables` plus `outbox` (architecture.md §4.3): validate → stamp → put →
 * outbox. Inside `fn`, use only `ctx.db`. If `fn` throws, every write in it is rolled back, including the outbox.
 */
export async function mutate<T>(tables: TableName[], fn: (ctx: WriteContext) => Promise<T>): Promise<T> {
  const deviceId = await getDeviceId()
  const at = now()
  const result = await db.transaction('rw', [...tables, 'outbox'], (tx) =>
    fn({ db: bindTables(tx), now: at, stampAt: nextStampTime(at), deviceId }),
  )
  notifyLocalChange()
  return result
}

let lastStamp = 0

/**
 * `at`, but strictly later than this device's previous stamp: two edits of one row in the same millisecond would
 * otherwise get the same stamp, and last-write-wins treats a repeated stamp as "no change" (§6.1).
 */
function nextStampTime(at: number): number {
  lastStamp = Math.max(at, lastStamp + 1)
  return lastStamp
}

/** Tests only: forget the previous stamp (after resetting the clock). */
export function resetStampTime() {
  lastStamp = 0
}
