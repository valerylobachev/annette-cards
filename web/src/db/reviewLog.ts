import type { ReviewLog } from '@/domain/types'
import { newId } from '@/lib/ids'
import { addToOutbox } from './outbox'
import { db } from './schema'
import { mutate, stamp, type WriteContext } from './write'

export type ReviewInput = Omit<ReviewLog, 'id' | 'updated_at' | 'updated_by' | 'deleted_at'>

// review_log is append-only: this module deliberately has no update function. The only allowed change is a soft
// delete for "undo last answer" (CLAUDE.md invariants).

/** Appends a log entry and records it in the outbox. Must run inside `mutate`. */
export async function appendReviewInTx(ctx: WriteContext, input: ReviewInput): Promise<ReviewLog> {
  const entry = stamp(ctx, { id: newId(), ...input, deleted_at: null })
  await db.review_log.add(entry)
  await addToOutbox('review_log', entry.id)
  return entry
}

export function appendReview(input: ReviewInput): Promise<ReviewLog> {
  return mutate(['review_log'], (ctx) => appendReviewInTx(ctx, input))
}

/** Undo of an answer: sets `deleted_at`, nothing else. */
export function softDeleteReview(id: string): Promise<void> {
  return mutate(['review_log'], async (ctx) => {
    const entry = await db.review_log.get(id)
    if (!entry) throw new Error(`Review ${id} not found`)
    const deleted = stamp(ctx, { ...entry, deleted_at: ctx.now })
    await db.review_log.put(deleted)
    await addToOutbox('review_log', id)
  })
}

/** Non-deleted log entries of a card, newest first. */
export async function listReviews(card_id: string): Promise<ReviewLog[]> {
  const entries = await db.review_log.where('card_id').equals(card_id).toArray()
  return entries.filter((entry) => entry.deleted_at === null).sort((a, b) => b.reviewed_at - a.reviewed_at)
}
