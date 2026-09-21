import { BACKUP_FORMAT, BACKUP_VERSION, type BackupV1 } from '@/domain/backup/format'
import { remapIds } from '@/domain/backup/regenerate'
import { deckToCsv } from '@/domain/export/csv'
import { mergeSettings } from '@/domain/settings'
import type { Card, CardState, Deck, ReviewLog } from '@/domain/types'
import { now } from '@/lib/clock'
import { newId } from '@/lib/ids'
import { ensureStatesForCards, writeCardState } from './cardStates'
import { listCards, writeCard } from './cards'
import { writeDeck } from './decks'
import { addToOutbox } from './outbox'
import { db } from './schema'
import { getSettings } from './settings'
import { mutate, stamp, type WriteContext } from './write'

const BATCH_SIZE = 500

/** Every non-deleted row as a version 1 backup (UC-24). */
export async function exportAll(): Promise<BackupV1> {
  return db.transaction('r', ['decks', 'cards', 'card_states', 'review_log', 'settings'], async () => {
    const decks = await db.decks.filter((deck) => deck.deleted_at === null).toArray()
    const deckIds = new Set(decks.map((deck) => deck.id))
    const cards = await db.cards.filter((card) => card.deleted_at === null && deckIds.has(card.deck_id)).toArray()
    const cardIds = new Set(cards.map((card) => card.id))
    const live = <T extends { card_id: string; deleted_at: number | null }>(row: T) =>
      row.deleted_at === null && cardIds.has(row.card_id)
    return {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exported_at: now(),
      app_version: __APP_VERSION__,
      decks,
      cards,
      card_states: await db.card_states.filter(live).toArray(),
      review_log: await db.review_log.filter(live).toArray(),
      settings: await getSettings(),
    }
  })
}

/** One deck's non-deleted cards in the CSV import format. */
export async function exportDeckCsv(deck_id: string): Promise<string> {
  return deckToCsv(await listCards(deck_id))
}

/**
 * "Replace local data" (UC-25): in one transaction, soft-deletes every current deck, card, state and log entry,
 * then writes the backup's rows and settings. Every row is stamped with this device and outboxed, so the restore
 * syncs like any other change. Atomic: a failure leaves the local data untouched.
 */
export function restoreReplace(backup: BackupV1): Promise<void> {
  return mutate(['decks', 'cards', 'card_states', 'review_log', 'settings'], async (ctx) => {
    await softDeleteEverything(ctx)
    await writeRows(ctx, backup.decks, backup.cards, backup.card_states, backup.review_log)
    await ctx.db.settings.put(stamp(ctx, { ...mergeSettings(backup.settings), id: 'user' as const }))
    await addToOutbox(ctx, 'settings', 'user')
  })
}

/**
 * "Add as new decks" (UC-25): the backup gets new ids and is added next to the local data, in transactions of
 * about 500 rows. Settings are not changed.
 */
export async function restoreAsNew(backup: BackupV1): Promise<void> {
  const remapped = remapIds(backup, newId)
  const tables = ['decks', 'cards', 'card_states', 'review_log'] as const
  await mutate([...tables], (ctx) => writeRows(ctx, remapped.decks, [], [], []))

  const statesByCard = groupBy(remapped.card_states, (state) => state.card_id)
  const logsByCard = groupBy(remapped.review_log, (log) => log.card_id)
  for (let start = 0; start < remapped.cards.length; start += BATCH_SIZE) {
    const cards = remapped.cards.slice(start, start + BATCH_SIZE)
    const ids = cards.map((card) => card.id)
    await mutate([...tables], (ctx) =>
      writeRows(
        ctx,
        [],
        cards,
        ids.flatMap((id) => statesByCard.get(id) ?? []),
        ids.flatMap((id) => logsByCard.get(id) ?? []),
      ),
    )
  }
}

async function softDeleteEverything(ctx: WriteContext) {
  for (const deck of await ctx.db.decks.filter((row) => row.deleted_at === null).toArray()) {
    await writeDeck(ctx, { ...deck, deleted_at: ctx.now })
  }
  for (const card of await ctx.db.cards.filter((row) => row.deleted_at === null).toArray()) {
    await writeCard(ctx, { ...card, deleted_at: ctx.now })
  }
  for (const state of await ctx.db.card_states.filter((row) => row.deleted_at === null).toArray()) {
    await writeCardState(ctx, { ...state, deleted_at: ctx.now })
  }
  for (const log of await ctx.db.review_log.filter((row) => row.deleted_at === null).toArray()) {
    // The one allowed change to a review log entry: a soft delete.
    await ctx.db.review_log.put(stamp(ctx, { ...log, deleted_at: ctx.now }))
    await addToOutbox(ctx, 'review_log', log.id)
  }
}

/**
 * Writes backup rows as live rows, stamped and outboxed. Cards without a state for an active direction get a New
 * one, so a hand-edited backup still produces studyable cards.
 */
async function writeRows(ctx: WriteContext, decks: Deck[], cards: Card[], states: CardState[], logs: ReviewLog[]) {
  for (const deck of decks) await writeDeck(ctx, { ...deck, deleted_at: null })
  for (const card of cards) await writeCard(ctx, { ...card, deleted_at: null })
  for (const state of states) await writeCardState(ctx, { ...state, deleted_at: null })
  for (const log of logs) {
    await ctx.db.review_log.put(stamp(ctx, { ...log, deleted_at: null }))
    await addToOutbox(ctx, 'review_log', log.id)
  }
  for (const [deck_id, deckCards] of groupBy(cards, (card) => card.deck_id)) {
    const deck = await ctx.db.decks.get(deck_id)
    if (deck) await ensureStatesForCards(ctx, deckCards, deck)
  }
}

function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>()
  for (const row of rows) {
    const list = groups.get(key(row))
    if (list) list.push(row)
    else groups.set(key(row), [row])
  }
  return groups
}
