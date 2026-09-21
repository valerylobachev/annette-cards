import type { CardState } from '@/domain/types'
import { addToOutbox, cardStateEntityId } from './outbox'
import { db } from './schema'
import { mutate, stamp, type WriteContext } from './write'

/** Stamps and stores a card state and records it in the outbox. Must run inside `mutate`. */
export async function writeCardState(ctx: WriteContext, state: CardState): Promise<CardState> {
  const stamped = stamp(ctx, state)
  await db.card_states.put(stamped)
  await addToOutbox('card_states', cardStateEntityId(stamped.card_id, stamped.direction))
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
