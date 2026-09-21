import type { Transaction } from 'dexie'
import type { SyncStamp } from '@/domain/types'
import { now } from '@/lib/clock'
import { getDeviceId } from './device'
import { type AnnetteDb, db, type TableName } from './schema'

/** The tables of one transaction. Operations on them always run in that transaction. */
export type TxTables = Pick<AnnetteDb, TableName>

/** One write transaction: its tables and the time and writer shared by every row it changes. */
export type WriteContext = { db: TxTables; now: number; deviceId: string }

/** Sets the last-write-wins fields (`updated_at`, `updated_by`) on an entity. */
export function stamp<T extends object>(ctx: WriteContext, entity: T): T & SyncStamp {
  return { ...entity, updated_at: ctx.now, updated_by: ctx.deviceId }
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
  return db.transaction('rw', [...tables, 'outbox'], (tx) => fn({ db: bindTables(tx), now: now(), deviceId }))
}
