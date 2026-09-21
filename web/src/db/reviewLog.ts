import type { Direction, ReviewLog } from '@/domain/types'
import { newId } from '@/lib/ids'
import { addToOutbox } from './outbox'
import { db } from './schema'
import { mutate, stamp, type WriteContext } from './write'

/** A new log entry; `practice` defaults to `false`. */
export type ReviewInput = Omit<ReviewLog, 'id' | 'updated_at' | 'updated_by' | 'deleted_at' | 'practice'> & {
  practice?: boolean
}

// review_log is append-only: this module deliberately has no update function. The only allowed change is a soft
// delete for "undo last answer" (CLAUDE.md invariants).

/** Appends a log entry and records it in the outbox, inside the caller's transaction. */
export async function appendReviewInTx(ctx: WriteContext, input: ReviewInput): Promise<ReviewLog> {
  const entry: ReviewLog = stamp(ctx, { id: newId(), ...input, practice: input.practice ?? false, deleted_at: null })
  await ctx.db.review_log.add(entry)
  await addToOutbox(ctx, 'review_log', entry.id)
  return entry
}

export function appendReview(input: ReviewInput): Promise<ReviewLog> {
  return mutate(['review_log'], (ctx) => appendReviewInTx(ctx, input))
}

/** Undo of an answer: sets `deleted_at`, nothing else. */
export function softDeleteReview(id: string): Promise<void> {
  return mutate(['review_log'], async (ctx) => {
    const entry = await ctx.db.review_log.get(id)
    if (!entry) throw new Error(`Review ${id} not found`)
    const deleted = stamp(ctx, { ...entry, deleted_at: ctx.now })
    await ctx.db.review_log.put(deleted)
    await addToOutbox(ctx, 'review_log', id)
  })
}

/** Non-deleted log entries of a card, newest first. */
export async function listReviews(card_id: string): Promise<ReviewLog[]> {
  const entries = await db.review_log.where('card_id').equals(card_id).toArray()
  return entries.filter((entry) => entry.deleted_at === null).sort((a, b) => b.reviewed_at - a.reviewed_at)
}

/** The last `limit` non-deleted answers for one direction of a card, newest first (card view history). */
export async function recentReviews(card_id: string, direction: Direction, limit = 10): Promise<ReviewLog[]> {
  const entries = await listReviews(card_id)
  return entries.filter((entry) => entry.direction === direction).slice(0, limit)
}
