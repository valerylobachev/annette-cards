import type { Card } from '@/domain/types'
import { newId } from '@/lib/ids'
import { ensureStatesForCard } from './cardStates'
import { requireDeckInTx } from './decks'
import { addToOutbox } from './outbox'
import { db } from './schema'
import { mutate, stamp, type WriteContext } from './write'

/** Editable card fields; optional text fields are `null` when empty. */
export type CardInput = Pick<
  Card,
  'deck_id' | 'front' | 'back' | 'example' | 'example_translation' | 'ipa' | 'tags' | 'notes'
>

type ReadOptions = { includeDeleted?: boolean }

/** Stamps and stores a card and records it in the outbox, inside the caller's transaction. */
export async function writeCard(ctx: WriteContext, card: Card): Promise<Card> {
  const stamped = stamp(ctx, card)
  await ctx.db.cards.put(stamped)
  await addToOutbox(ctx, 'cards', stamped.id)
  return stamped
}

/** Creates a card and a New state for each active direction of its deck. */
export function createCard(input: CardInput): Promise<Card> {
  return mutate(['decks', 'cards', 'card_states'], async (ctx) => {
    const deck = await requireDeckInTx(ctx, input.deck_id)
    const card = await writeCard(ctx, {
      id: newId(),
      ...input,
      audio_id: null,
      created_at: ctx.now,
      deleted_at: null,
      updated_at: ctx.now,
      updated_by: ctx.deviceId,
    })
    await ensureStatesForCard(ctx, card, deck)
    return card
  })
}

export function updateCard(id: string, patch: Partial<CardInput>): Promise<Card> {
  return mutate(['cards'], async (ctx) => {
    const card = await requireCardInTx(ctx, id)
    return writeCard(ctx, { ...card, ...patch })
  })
}

/** Soft delete: sets `deleted_at`; the row stays for sync. */
export function deleteCard(id: string): Promise<void> {
  return mutate(['cards'], async (ctx) => {
    const card = await requireCardInTx(ctx, id)
    await writeCard(ctx, { ...card, deleted_at: ctx.now })
  })
}

export async function getCard(id: string, { includeDeleted = false }: ReadOptions = {}): Promise<Card | undefined> {
  const card = await db.cards.get(id)
  return card && (includeDeleted || card.deleted_at === null) ? card : undefined
}

/** Cards of a deck in creation order; soft-deleted ones are excluded unless asked for. */
export function listCards(deck_id: string, { includeDeleted = false }: ReadOptions = {}): Promise<Card[]> {
  return db.cards
    .where('deck_id')
    .equals(deck_id)
    .filter((card) => includeDeleted || card.deleted_at === null)
    .sortBy('created_at')
}

export async function requireCardInTx(ctx: WriteContext, id: string): Promise<Card> {
  const card = await ctx.db.cards.get(id)
  if (!card) throw new Error(`Card ${id} not found`)
  return card
}
