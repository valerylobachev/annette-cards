import { type CardDraft, type CardFields, validateCardInput } from '@/domain/cardValidation'
import { normalizeFront } from '@/domain/normalize'
import type { Card } from '@/domain/types'
import { ValidationError } from '@/domain/validation'
import { newId } from '@/lib/ids'
import { ensureStatesForCard } from './cardStates'
import { requireDeckInTx } from './decks'
import { addToOutbox } from './outbox'
import { db } from './schema'
import { mutate, stamp, type WriteContext } from './write'

export type { CardDraft }

type ReadOptions = { includeDeleted?: boolean }

/** Stamps and stores a card and records it in the outbox, inside the caller's transaction. */
export async function writeCard(ctx: WriteContext, card: Card): Promise<Card> {
  const stamped = stamp(ctx, card)
  await ctx.db.cards.put(stamped)
  await addToOutbox(ctx, 'cards', stamped.id)
  return stamped
}

function validated(draft: CardDraft): CardFields {
  const { value, errors } = validateCardInput(draft)
  if (errors.length > 0) throw new ValidationError(errors)
  return value
}

/** Creates a card and a New state for each active direction of its deck. */
export function createCard(draft: CardDraft): Promise<Card> {
  return mutate(['decks', 'cards', 'card_states'], async (ctx) => {
    const value = validated(draft)
    const deck = await requireDeckInTx(ctx, value.deck_id)
    const card = await writeCard(ctx, {
      id: newId(),
      ...value,
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

/** Updates card fields. Moving a card to another deck adds states for that deck's active directions. */
export function updateCard(id: string, patch: Partial<CardDraft>): Promise<Card> {
  return mutate(['decks', 'cards', 'card_states'], async (ctx) => {
    const card = await requireCardInTx(ctx, id)
    const value = validated({ ...card, ...patch })
    const updated = await writeCard(ctx, { ...card, ...value })
    if (updated.deck_id !== card.deck_id) {
      await ensureStatesForCard(ctx, updated, await requireDeckInTx(ctx, updated.deck_id))
    }
    return updated
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

/**
 * A non-deleted card in the deck whose front equals `front` after `normalizeFront` (duplicate warning, D10).
 * `excludeId` skips the card being edited.
 */
export async function findDuplicate(deck_id: string, front: string, excludeId?: string): Promise<Card | undefined> {
  const needle = normalizeFront(front)
  if (needle === '') return undefined
  return db.cards
    .where('deck_id')
    .equals(deck_id)
    .filter((card) => card.deleted_at === null && card.id !== excludeId && normalizeFront(card.front) === needle)
    .first()
}

/** Distinct tags of non-deleted cards, sorted, for autocomplete. */
export async function listTags(): Promise<string[]> {
  const tags = new Set<string>()
  await db.cards
    .filter((card) => card.deleted_at === null)
    .each((card) => {
      for (const tag of card.tags) tags.add(tag)
    })
  return [...tags].sort((a, b) => a.localeCompare(b))
}
