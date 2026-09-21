import { activeDirections, newCardState } from '@/domain/directions'
import type { Card, CardState, Deck, Direction } from '@/domain/types'
import { addToOutbox, cardStateEntityId } from './outbox'
import { db } from './schema'
import { mutate, stamp, type WriteContext } from './write'

/** Stamps and stores a card state and records it in the outbox, inside the caller's transaction. */
export async function writeCardState(ctx: WriteContext, state: CardState): Promise<CardState> {
  const stamped = stamp(ctx, state)
  await ctx.db.card_states.put(stamped)
  await addToOutbox(ctx, 'card_states', cardStateEntityId(stamped.card_id, stamped.direction))
  return stamped
}

export function saveCardState(state: CardState): Promise<CardState> {
  return mutate(['card_states'], (ctx) => writeCardState(ctx, state))
}

/** States of one card (forward first); soft-deleted states are excluded. */
export async function getCardStates(card_id: string): Promise<CardState[]> {
  const states = await db.card_states.where('card_id').equals(card_id).toArray()
  return states.filter((state) => state.deleted_at === null).sort((a, b) => a.direction.localeCompare(b.direction))
}

/**
 * Creates the missing New states for the deck's active directions (architecture.md §4.4), inside the caller's
 * transaction. Existing states are never reset; states of a direction the deck no longer uses are kept (hidden
 * from study queues, not deleted).
 */
export async function ensureStatesForCards(ctx: WriteContext, cards: Card[], deck: Deck): Promise<void> {
  const directions = activeDirections(deck.directions)
  const keys = cards.flatMap((card) => directions.map((direction): [string, Direction] => [card.id, direction]))
  const existing = await ctx.db.card_states.bulkGet(keys)
  for (const [i, [card_id, direction]] of keys.entries()) {
    if (!existing[i]) await writeCardState(ctx, newCardState(card_id, direction, ctx.now))
  }
}

export function ensureStatesForCard(ctx: WriteContext, card: Card, deck: Deck): Promise<void> {
  return ensureStatesForCards(ctx, [card], deck)
}

/** After a deck's directions changed: gives every card of the deck a state for each newly active direction. */
export async function applyDeckDirections(ctx: WriteContext, deck: Deck): Promise<void> {
  const cards = await ctx.db.cards
    .where('deck_id')
    .equals(deck.id)
    .filter((card) => card.deleted_at === null)
    .toArray()
  await ensureStatesForCards(ctx, cards, deck)
}

/**
 * Puts every non-deleted state of the cards back to New (`newCardState`). The review log is kept: history is
 * append-only, only the schedule starts over.
 */
export function resetProgress(card_ids: string[]): Promise<void> {
  return mutate(['card_states'], async (ctx) => {
    const states = await ctx.db.card_states.where('card_id').anyOf(card_ids).toArray()
    for (const state of states) {
      if (state.deleted_at === null) await writeCardState(ctx, newCardState(state.card_id, state.direction, ctx.now))
    }
  })
}
