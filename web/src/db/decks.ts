import { type DeckInput, validateDeckInput } from '@/domain/deckValidation'
import type { Deck } from '@/domain/types'
import { ValidationError } from '@/domain/validation'
import { newId } from '@/lib/ids'
import { addToOutbox } from './outbox'
import { db } from './schema'
import { mutate, stamp, type WriteContext } from './write'

export type { DeckInput }

type ReadOptions = { includeDeleted?: boolean }

/** Stamps and stores a deck and records it in the outbox. Must run inside `mutate`. */
export async function writeDeck(ctx: WriteContext, deck: Deck): Promise<Deck> {
  const stamped = stamp(ctx, deck)
  await db.decks.put(stamped)
  await addToOutbox('decks', stamped.id)
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

export function updateDeck(id: string, patch: Partial<DeckInput>): Promise<Deck> {
  return mutate(['decks'], async (ctx) => {
    const deck = await requireDeck(id)
    const value = validated({ ...deck, ...patch })
    return writeDeck(ctx, { ...deck, ...value })
  })
}

/** Soft delete: sets `deleted_at`; the row stays for sync. */
export function deleteDeck(id: string): Promise<void> {
  return mutate(['decks'], async (ctx) => {
    const deck = await requireDeck(id)
    await writeDeck(ctx, { ...deck, deleted_at: ctx.now })
  })
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

export async function requireDeck(id: string): Promise<Deck> {
  const deck = await db.decks.get(id)
  if (!deck) throw new Error(`Deck ${id} not found`)
  return deck
}
