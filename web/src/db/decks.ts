import { type DeckSummary, summarizeDeck } from '@/domain/deckStats'
import { type DeckInput, validateDeckInput } from '@/domain/deckValidation'
import type { CardState, Deck } from '@/domain/types'
import { ValidationError } from '@/domain/validation'
import { now } from '@/lib/clock'
import { newId } from '@/lib/ids'
import { applyDeckDirections, writeCardState } from './cardStates'
import { writeCard } from './cards'
import { addToOutbox } from './outbox'
import { db } from './schema'
import { mutate, stamp, type WriteContext } from './write'

export type { DeckInput }

type ReadOptions = { includeDeleted?: boolean }

/** Stamps and stores a deck and records it in the outbox, inside the caller's transaction. */
export async function writeDeck(ctx: WriteContext, deck: Deck): Promise<Deck> {
  const stamped = stamp(ctx, deck)
  await ctx.db.decks.put(stamped)
  await addToOutbox(ctx, 'decks', stamped.id)
  return stamped
}

function validated(input: DeckInput): DeckInput {
  const { value, errors } = validateDeckInput(input)
  if (errors.length > 0) throw new ValidationError(errors)
  return value
}

export function createDeck(input: DeckInput): Promise<Deck> {
  return mutate(['decks'], async (ctx) => {
    const value = validated(input)
    return writeDeck(ctx, {
      id: newId(),
      ...value,
      archived_at: null,
      created_at: ctx.now,
      deleted_at: null,
      updated_at: ctx.now,
      updated_by: ctx.deviceId,
    })
  })
}

/** Updates deck fields; when `directions` changed, cards get New states for newly active directions. */
export function updateDeck(id: string, patch: Partial<DeckInput>): Promise<Deck> {
  return mutate(['decks', 'cards', 'card_states'], async (ctx) => {
    const deck = await requireDeckInTx(ctx, id)
    const value = validated({ ...deck, ...patch })
    const updated = await writeDeck(ctx, { ...deck, ...value })
    if (updated.directions !== deck.directions) await applyDeckDirections(ctx, updated)
    return updated
  })
}

export function archiveDeck(id: string): Promise<void> {
  return mutate(['decks'], async (ctx) => {
    await writeDeck(ctx, { ...(await requireDeckInTx(ctx, id)), archived_at: ctx.now })
  })
}

export function unarchiveDeck(id: string): Promise<void> {
  return mutate(['decks'], async (ctx) => {
    await writeDeck(ctx, { ...(await requireDeckInTx(ctx, id)), archived_at: null })
  })
}

/**
 * Soft-deletes the deck, its cards and their states in one transaction (architecture.md §6.1). They all get the
 * same `deleted_at`, which is how `undeleteDeck` finds exactly these rows again.
 */
export function deleteDeck(id: string): Promise<void> {
  return mutate(['decks', 'cards', 'card_states'], async (ctx) => {
    const deck = await requireDeckInTx(ctx, id)
    if (deck.deleted_at !== null) return
    await writeDeck(ctx, { ...deck, deleted_at: ctx.now })
    await setDeletedAt(ctx, id, null, ctx.now)
  })
}

/** Undo of `deleteDeck`: restores the deck and the cards and states deleted together with it. */
export function undeleteDeck(id: string): Promise<void> {
  return mutate(['decks', 'cards', 'card_states'], async (ctx) => {
    const deck = await requireDeckInTx(ctx, id)
    if (deck.deleted_at === null) return
    await writeDeck(ctx, { ...deck, deleted_at: null })
    await setDeletedAt(ctx, id, deck.deleted_at, null)
  })
}

/** Moves the deck's cards and their states whose `deleted_at` equals `from` to `to`. */
async function setDeletedAt(ctx: WriteContext, deck_id: string, from: number | null, to: number | null) {
  const cards = await ctx.db.cards
    .where('deck_id')
    .equals(deck_id)
    .filter((card) => card.deleted_at === from)
    .toArray()
  for (const card of cards) {
    await writeCard(ctx, { ...card, deleted_at: to })
    for (const state of await ctx.db.card_states.where('card_id').equals(card.id).toArray()) {
      if (state.deleted_at === from) await writeCardState(ctx, { ...state, deleted_at: to })
    }
  }
}

export async function getDeck(id: string, { includeDeleted = false }: ReadOptions = {}): Promise<Deck | undefined> {
  const deck = await db.decks.get(id)
  return deck && (includeDeleted || deck.deleted_at === null) ? deck : undefined
}

/** Decks ordered by name; soft-deleted ones are excluded unless asked for. */
export async function listDecks({ includeDeleted = false }: ReadOptions = {}): Promise<Deck[]> {
  const decks = await db.decks.filter((deck) => includeDeleted || deck.deleted_at === null).toArray()
  return decks.sort((a, b) => a.name.localeCompare(b.name))
}

export async function requireDeckInTx(ctx: WriteContext, id: string): Promise<Deck> {
  const deck = await ctx.db.decks.get(id)
  if (!deck) throw new Error(`Deck ${id} not found`)
  return deck
}

export type DeckWithSummary = { deck: Deck; summary: DeckSummary }

/** Every non-deleted deck with its counts for the decks list. */
export async function listDeckSummaries(): Promise<DeckWithSummary[]> {
  const [decks, cards, states] = await Promise.all([
    listDecks(),
    db.cards.filter((card) => card.deleted_at === null).toArray(),
    db.card_states.filter((state) => state.deleted_at === null).toArray(),
  ])
  const deckOfCard = new Map(cards.map((card) => [card.id, card.deck_id]))
  const cardCounts = new Map<string, number>()
  for (const card of cards) cardCounts.set(card.deck_id, (cardCounts.get(card.deck_id) ?? 0) + 1)
  const statesByDeck = new Map<string, CardState[]>()
  for (const state of states) {
    const deck_id = deckOfCard.get(state.card_id)
    if (deck_id) statesByDeck.set(deck_id, [...(statesByDeck.get(deck_id) ?? []), state])
  }
  const time = now()
  return decks.map((deck) => ({
    deck,
    summary: summarizeDeck(deck, cardCounts.get(deck.id) ?? 0, statesByDeck.get(deck.id) ?? [], time),
  }))
}
