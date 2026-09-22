import { Dexie, type EntityTable, type Table } from 'dexie'
import type { Card, CardState, Deck, Direction, ReviewLog, Settings, SyncedEntity, SyncStamp } from '@/domain/types'
import { DB_NAME } from './dbName'
import type { MetaKey } from './meta'

export { DB_NAME }

/** One pending change for the sync engine; at most one row per entity (architecture.md §4.3). */
export type OutboxEntry = { seq?: number; entity: SyncedEntity; entity_id: string }

/** The settings document as stored: possibly partial, merged with defaults on read. */
export type SettingsRow = Partial<Settings> & SyncStamp & { id: 'user' }

export type MetaRow = { key: MetaKey; value: unknown }

export class AnnetteDb extends Dexie {
  decks!: EntityTable<Deck, 'id'>
  cards!: EntityTable<Card, 'id'>
  card_states!: Table<CardState, [string, Direction]>
  review_log!: EntityTable<ReviewLog, 'id'>
  settings!: EntityTable<SettingsRow, 'id'>
  outbox!: EntityTable<OutboxEntry, 'seq'>
  meta!: EntityTable<MetaRow, 'key'>

  constructor(name: string = DB_NAME) {
    super(name)
    // Schema v1 exactly as architecture.md §4.2. Only indexed fields are listed.
    this.version(1).stores({
      decks: 'id, updated_at, deleted_at',
      cards: 'id, deck_id, updated_at, deleted_at, *tags',
      card_states: '[card_id+direction], card_id, due, state, updated_at',
      review_log: 'id, card_id, reviewed_at',
      settings: 'id',
      outbox: '++seq, [entity+entity_id]',
      meta: 'key',
    })
  }
}

/** Factory for tests that need an isolated database. */
export function createDb(name: string = DB_NAME) {
  return new AnnetteDb(name)
}

/** The app's database. Repositories in `src/db/` are the only code that touches it. */
export const db = createDb()

export type TableName = 'decks' | 'cards' | 'card_states' | 'review_log' | 'settings' | 'outbox' | 'meta'
