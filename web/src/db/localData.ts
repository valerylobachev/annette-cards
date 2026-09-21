import type { SyncedEntity } from '@/domain/types'
import { forgetDeviceId } from './device'
import type { MetaKey } from './meta'
import { cardStateEntityId } from './outbox'
import { db } from './schema'

/** "Local data" for the first sign-in (architecture.md §6.4): at least one deck that is not deleted. */
export async function hasLocalData(): Promise<boolean> {
  return (await db.decks.filter((deck) => deck.deleted_at === null).count()) > 0
}

/** Decks and cards that are not deleted (cards only in such decks), for the S-03 comparison. */
export async function localCounts(): Promise<{ decks: number; cards: number }> {
  return db.transaction('r', db.decks, db.cards, async () => {
    const decks = await db.decks.filter((deck) => deck.deleted_at === null).toArray()
    const ids = new Set(decks.map((deck) => deck.id))
    const cards = await db.cards.filter((card) => card.deleted_at === null && ids.has(card.deck_id)).count()
    return { decks: decks.length, cards }
  })
}

/**
 * Queues every local row (soft-deleted ones included) for the next push, each exactly once, keeping its stamp:
 * "Merge" on first sign-in pushes everything the device has.
 */
export async function enqueueAll(): Promise<number> {
  const tables = [db.outbox, db.decks, db.cards, db.card_states, db.review_log, db.settings]
  return db.transaction('rw', tables, async () => {
    const entries: { entity: SyncedEntity; entity_id: string }[] = [
      ...(await db.decks.toCollection().primaryKeys()).map((id) => ({ entity: 'decks' as const, entity_id: id })),
      ...(await db.cards.toCollection().primaryKeys()).map((id) => ({ entity: 'cards' as const, entity_id: id })),
      ...(await db.card_states.toArray()).map((state) => ({
        entity: 'card_states' as const,
        entity_id: cardStateEntityId(state.card_id, state.direction),
      })),
      ...(await db.review_log.toCollection().primaryKeys()).map((id) => ({
        entity: 'review_log' as const,
        entity_id: id,
      })),
      ...((await db.settings.get('user')) ? [{ entity: 'settings' as const, entity_id: 'user' }] : []),
    ]
    await db.outbox.clear()
    await db.outbox.bulkAdd(entries)
    return entries.length
  })
}

/**
 * Device-local preferences that survive a wipe: they describe this device, not the account (voices differ between
 * devices, the theme and speech rate are personal to the device's user).
 */
const KEPT_META: MetaKey[] = [
  'theme',
  'voice_pref',
  'speech_rate',
  'audio_prefetch',
  'install_hint_shown',
  'storage_persisted',
]

/**
 * Removes every row of the account from this device: decks, cards, states, reviews, settings, the outbox and the
 * account-related `meta` (account, sync cursor and log, study session, onboarding…). Only `KEPT_META` stays; the
 * device gets a new id on its next write. This is the only physical delete in the app and is local-only (sign-out,
 * "Use account data").
 */
export async function wipeLocalData(): Promise<void> {
  const tables = [db.decks, db.cards, db.card_states, db.review_log, db.settings, db.outbox, db.meta]
  await db.transaction('rw', tables, async () => {
    for (const table of tables.slice(0, -1)) await table.clear()
    await db.meta.filter((row) => !KEPT_META.includes(row.key)).delete()
  })
  forgetDeviceId()
}
