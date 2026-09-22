import type { Direction, SyncedEntity } from '@/domain/types'
import { db, type OutboxEntry } from './schema'
import type { WriteContext } from './write'

export type { OutboxEntry }

/** Outbox id of a card state: its compound primary key as one string. */
export function cardStateEntityId(card_id: string, direction: Direction) {
  return `${card_id}:${direction}`
}

/**
 * Records that an entity changed, inside the caller's transaction.
 *
 * Deduplicated by `[entity+entity_id]`: an existing entry is replaced by one with a new `seq`, so a push that is
 * already in flight (and clears entries up to its last `seq`) cannot drop this later change.
 */
export async function addToOutbox(ctx: WriteContext, entity: SyncedEntity, entity_id: string): Promise<void> {
  await ctx.db.outbox.where('[entity+entity_id]').equals([entity, entity_id]).delete()
  await ctx.db.outbox.add({ entity, entity_id })
}

/** `addToOutbox` for many entities of one kind with bulk operations (imports and other batches). */
export async function addAllToOutbox(ctx: WriteContext, entity: SyncedEntity, entity_ids: string[]): Promise<void> {
  if (entity_ids.length === 0) return
  await ctx.db.outbox
    .where('[entity+entity_id]')
    .anyOf(entity_ids.map((id) => [entity, id]))
    .delete()
  await ctx.db.outbox.bulkAdd(entity_ids.map((entity_id) => ({ entity, entity_id })))
}

export function listOutbox(): Promise<OutboxEntry[]> {
  return db.outbox.orderBy('seq').toArray()
}
