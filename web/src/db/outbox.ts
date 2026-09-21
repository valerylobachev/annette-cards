import { Dexie } from 'dexie'
import type { Direction, SyncedEntity } from '@/domain/types'
import { db, type OutboxEntry } from './schema'

export type { OutboxEntry }

/** Outbox id of a card state: its compound primary key as one string. */
export function cardStateEntityId(card_id: string, direction: Direction) {
  return `${card_id}:${direction}`
}

/**
 * Records that an entity changed. Must run inside the caller's `rw` transaction (see `mutate`).
 *
 * Deduplicated by `[entity+entity_id]`: an existing entry is replaced by one with a new `seq`, so a push that is
 * already in flight (and clears entries up to its last `seq`) cannot drop this later change.
 */
export async function addToOutbox(entity: SyncedEntity, entity_id: string): Promise<void> {
  if (!Dexie.currentTransaction) throw new Error('addToOutbox must run inside a transaction')
  await db.outbox.where('[entity+entity_id]').equals([entity, entity_id]).delete()
  await db.outbox.add({ entity, entity_id })
}

export function listOutbox(): Promise<OutboxEntry[]> {
  return db.outbox.orderBy('seq').toArray()
}
