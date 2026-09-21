import { incomingWins } from '@/domain/sync/lww'
import type { Card, CardState, Deck, ReviewLog } from '@/domain/types'
import { setMeta } from './meta'
import type { OutboxEntry } from './outbox'
import { db, type SettingsRow } from './schema'

/**
 * The sync engine's side of the repositories: rows pulled from the server are written as they are (their own
 * stamps), never outboxed and never announced as local changes (architecture.md §4.3, §6.2).
 */

export type RemoteChanges = {
  decks: Deck[]
  cards: Card[]
  card_states: CardState[]
  review_log: ReviewLog[]
  settings: SettingsRow | null
}

/**
 * Merges one pulled page and saves its cursor, in one transaction: a new row is inserted, a known one replaced only
 * when the pulled row wins last-write-wins; for review log entries only a first `deleted_at` (undo) is taken over.
 * A pulled row that loses keeps the local version, which is still in the outbox and reaches the server on the next
 * push. Returns how many rows changed locally.
 */
export async function applyRemoteChanges(changes: RemoteChanges, cursor: number): Promise<number> {
  const tables = [db.decks, db.cards, db.card_states, db.review_log, db.settings, db.meta]
  return db.transaction('rw', tables, async () => {
    let written = 0
    for (const deck of changes.decks) {
      if (winsOver(deck, await db.decks.get(deck.id))) written += await put(db.decks.put(deck))
    }
    for (const card of changes.cards) {
      if (winsOver(card, await db.cards.get(card.id))) written += await put(db.cards.put(card))
    }
    for (const state of changes.card_states) {
      const local = await db.card_states.get([state.card_id, state.direction])
      if (winsOver(state, local)) written += await put(db.card_states.put(state))
    }
    for (const log of changes.review_log) {
      const local = await db.review_log.get(log.id)
      if (!local) written += await put(db.review_log.put(log))
      else if (local.deleted_at === null && log.deleted_at !== null) {
        const { deleted_at, updated_at, updated_by } = log
        written += await put(db.review_log.put({ ...local, deleted_at, updated_at, updated_by }))
      }
    }
    if (changes.settings && winsOver(changes.settings, await db.settings.get('user'))) {
      written += await put(db.settings.put(changes.settings))
    }
    await setMeta('sync_cursor', cursor)
    return written
  })
}

function winsOver<T extends { updated_at: number; updated_by: string }>(incoming: T, local: T | undefined): boolean {
  return local === undefined || incomingWins(incoming, local)
}

async function put(write: Promise<unknown>): Promise<number> {
  await write
  return 1
}

/** A row to push, with the outbox entry it came from. */
export type OutboxRow =
  | { entry: OutboxEntry; entity: 'decks'; row: Deck }
  | { entry: OutboxEntry; entity: 'cards'; row: Card }
  | { entry: OutboxEntry; entity: 'card_states'; row: CardState }
  | { entry: OutboxEntry; entity: 'review_log'; row: ReviewLog }
  | { entry: OutboxEntry; entity: 'settings'; row: SettingsRow }

/**
 * The current rows (soft-deleted ones included) of every outbox entry, in `seq` order. An entry whose row no longer
 * exists is removed.
 */
export async function readOutboxRows(): Promise<OutboxRow[]> {
  return db.transaction('rw', [db.outbox, db.decks, db.cards, db.card_states, db.review_log, db.settings], async () => {
    const entries = await db.outbox.orderBy('seq').toArray()
    const rows: OutboxRow[] = []
    for (const entry of entries) {
      const row = await loadRow(entry)
      if (row) rows.push(row)
      else if (entry.seq !== undefined) await db.outbox.delete(entry.seq)
    }
    return rows
  })
}

async function loadRow(entry: OutboxEntry): Promise<OutboxRow | undefined> {
  const id = entry.entity_id
  switch (entry.entity) {
    case 'decks': {
      const row = await db.decks.get(id)
      return row && { entry, entity: 'decks', row }
    }
    case 'cards': {
      const row = await db.cards.get(id)
      return row && { entry, entity: 'cards', row }
    }
    case 'card_states': {
      const [card_id = '', direction] = splitStateId(id)
      const row = direction ? await db.card_states.get([card_id, direction]) : undefined
      return row && { entry, entity: 'card_states', row }
    }
    case 'review_log': {
      const row = await db.review_log.get(id)
      return row && { entry, entity: 'review_log', row }
    }
    case 'settings': {
      const row = await db.settings.get('user')
      return row && { entry, entity: 'settings', row }
    }
  }
}

/** `"{card_id}:{direction}"` → parts (card ids are UUIDs, so the last colon separates the direction). */
function splitStateId(id: string): [string, 'forward' | 'reverse' | undefined] {
  const at = id.lastIndexOf(':')
  const direction = id.slice(at + 1)
  return [id.slice(0, at), direction === 'forward' || direction === 'reverse' ? direction : undefined]
}

/**
 * Removes the outbox entries of a finished push: the server answered every row (applied, skipped or rejected). An
 * entry is removed only if it is still the one that was sent (same `seq`): a row edited during the request got a new
 * entry and stays queued.
 */
export async function clearSentEntries(sent: OutboxEntry[]): Promise<void> {
  const seqs = sent.map((entry) => entry.seq).filter((seq): seq is number => seq !== undefined)
  await db.outbox.bulkDelete(seqs)
}
