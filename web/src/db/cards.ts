import type { CardWithStates } from '@/domain/cardFilters'
import { type CardDraft, type CardFields, cleanTags, validateCardInput } from '@/domain/cardValidation'
import { activeDirections } from '@/domain/directions'
import { normalizeFront } from '@/domain/normalize'
import type { Card } from '@/domain/types'
import { ValidationError } from '@/domain/validation'
import { newId } from '@/lib/ids'
import { ensureStatesForCard, writeCardState } from './cardStates'
import { getDeck, requireDeckInTx } from './decks'
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

/** Soft delete of one card and its states; see `deleteCards`. */
export function deleteCard(id: string): Promise<number> {
  return deleteCards([id])
}

/**
 * Soft-deletes cards and their states in one transaction. Returns the shared `deleted_at`, which `undeleteCards`
 * uses to restore exactly these rows.
 */
export function deleteCards(ids: string[]): Promise<number> {
  return mutate(['cards', 'card_states'], async (ctx) => {
    await setCardsDeletedAt(ctx, ids, null, ctx.now)
    return ctx.now
  })
}

/** Undo of `deleteCards`. */
export function undeleteCards(ids: string[], deletedAt: number): Promise<void> {
  return mutate(['cards', 'card_states'], (ctx) => setCardsDeletedAt(ctx, ids, deletedAt, null))
}

async function setCardsDeletedAt(ctx: WriteContext, ids: string[], from: number | null, to: number | null) {
  for (const card of await ctx.db.cards.bulkGet(ids)) {
    if (!card || card.deleted_at !== from) continue
    await writeCard(ctx, { ...card, deleted_at: to })
    for (const state of await ctx.db.card_states.where('card_id').equals(card.id).toArray()) {
      if (state.deleted_at === from) await writeCardState(ctx, { ...state, deleted_at: to })
    }
  }
}

/** Moves cards to another deck; each gets states for that deck's active directions. */
export function moveCards(ids: string[], deck_id: string): Promise<void> {
  return mutate(['decks', 'cards', 'card_states'], async (ctx) => {
    const deck = await requireDeckInTx(ctx, deck_id)
    for (const card of await liveCards(ctx, ids)) {
      if (card.deck_id === deck_id) continue
      const moved = await writeCard(ctx, { ...card, deck_id })
      await ensureStatesForCard(ctx, moved, deck)
    }
  })
}

/** Adds a tag to cards that do not have it yet. */
export function addTag(ids: string[], tag: string): Promise<void> {
  return mutate(['cards'], async (ctx) => {
    const [clean] = cleanTags([tag])
    if (!clean) return
    for (const card of await liveCards(ctx, ids)) {
      const tags = cleanTags([...card.tags, clean])
      if (tags.length !== card.tags.length) await writeCard(ctx, { ...card, tags })
    }
  })
}

export function removeTag(ids: string[], tag: string): Promise<void> {
  return mutate(['cards'], async (ctx) => {
    for (const card of await liveCards(ctx, ids)) {
      if (card.tags.includes(tag)) await writeCard(ctx, { ...card, tags: card.tags.filter((t) => t !== tag) })
    }
  })
}

async function liveCards(ctx: WriteContext, ids: string[]): Promise<Card[]> {
  const cards = await ctx.db.cards.bulkGet(ids)
  return cards.filter((card): card is Card => card !== undefined && card.deleted_at === null)
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

/**
 * Non-deleted cards of a deck with their non-deleted states in the deck's active directions (S-06). Returns
 * `null` when the deck does not exist or is deleted.
 */
export async function listDeckCardsWithStates(deck_id: string): Promise<CardWithStates[] | null> {
  const deck = await getDeck(deck_id)
  if (!deck) return null
  const directions = new Set(activeDirections(deck.directions))
  const cards = await listCards(deck_id)
  const states = await db.card_states
    .where('card_id')
    .anyOf(cards.map((card) => card.id))
    .filter((state) => state.deleted_at === null && directions.has(state.direction))
    .toArray()
  const byCard = new Map<string, CardWithStates>(cards.map((card) => [card.id, { card, states: [] }]))
  for (const state of states) byCard.get(state.card_id)?.states.push(state)
  return [...byCard.values()]
}
