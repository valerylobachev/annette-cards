import { createScheduler, nextState, snapshotOf } from '@/domain/fsrs'
import { REINSERT_WITHIN_MS } from '@/domain/session'
import type { CardState, Direction, Rating, ReviewMode } from '@/domain/types'
import { writeCardState } from './cardStates'
import { addToOutbox } from './outbox'
import { appendReviewInTx } from './reviewLog'
import { getSettings } from './settings'
import { mutate, stamp } from './write'

export type AnswerInput = {
  card_id: string
  direction: Direction
  rating: Rating
  mode: ReviewMode
  duration_ms: number
  /** Practice mode (UC-16): a card that is not due yet keeps its state. */
  practice?: boolean
}

export type AnswerResult = {
  log_id: string
  /** The state after the answer (unchanged for practice on a card that is not due). */
  nextState: CardState
  /** The next step is due within 20 minutes: put the card back into the current session. */
  reinsert: boolean
}

export type StudyErrorCode = 'state_not_found' | 'log_not_found' | 'undo_not_last'

export class StudyError extends Error {
  readonly code: StudyErrorCode

  constructor(code: StudyErrorCode) {
    super(code)
    this.name = 'StudyError'
    this.code = code
  }
}

/**
 * Records one answer (architecture.md §4.4 "Answer transaction"): in one transaction the next FSRS state and a
 * review log entry with the previous state as `state_before`, both stamped and outboxed.
 */
export async function answer(input: AnswerInput): Promise<AnswerResult> {
  const scheduler = createScheduler(await getSettings())
  return mutate(['card_states', 'review_log'], async (ctx) => {
    const current = await ctx.db.card_states.get([input.card_id, input.direction])
    if (!current || current.deleted_at !== null) throw new StudyError('state_not_found')

    const keepState = input.practice === true && current.due > ctx.now
    const next = keepState
      ? current
      : await writeCardState(ctx, nextState(scheduler, current, input.rating, ctx.now).state)
    const log = await appendReviewInTx(ctx, {
      card_id: input.card_id,
      direction: input.direction,
      rating: input.rating,
      mode: input.mode,
      state_before: snapshotOf(current),
      reviewed_at: ctx.now,
      duration_ms: input.duration_ms,
      practice: input.practice ?? false,
    })
    return { log_id: log.id, nextState: next, reinsert: !keepState && next.due - ctx.now < REINSERT_WITHIN_MS }
  })
}

/**
 * Undo of the last answer (UC-17): restores the state from the log's `state_before` with a new `updated_at` (so it
 * wins last-write-wins) and soft-deletes the log entry, in one transaction. Only the latest non-deleted answer can
 * be undone (`undo_not_last`); the session keeps the id, so there is one level of undo.
 */
export function undoAnswer(log_id: string): Promise<CardState> {
  return mutate(['card_states', 'review_log'], async (ctx) => {
    const log = await ctx.db.review_log.get(log_id)
    if (!log || log.deleted_at !== null) throw new StudyError('log_not_found')
    const newer = await ctx.db.review_log
      .where('reviewed_at')
      .aboveOrEqual(log.reviewed_at)
      .filter((other) => other.deleted_at === null && other.id !== log.id)
      .toArray()
    if (newer.some((other) => other.reviewed_at > log.reviewed_at || other.id > log.id)) {
      throw new StudyError('undo_not_last')
    }

    const current = await ctx.db.card_states.get([log.card_id, log.direction])
    if (!current) throw new StudyError('state_not_found')
    const restored = await writeCardState(ctx, { ...current, ...log.state_before })
    // The one allowed change to a review log entry: a soft delete.
    await ctx.db.review_log.put(stamp(ctx, { ...log, deleted_at: ctx.now }))
    await addToOutbox(ctx, 'review_log', log.id)
    return restored
  })
}
