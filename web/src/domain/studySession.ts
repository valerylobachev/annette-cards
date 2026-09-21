import { type QueueItem, type QueueItemKind, reinsertLearning } from './session'

/** Returning to the study screen within this time continues the saved session (ui_ux.md S-11 "Interruptions"). */
export const RESUME_WITHIN_MS = 30 * 60_000
/** Longer thinking (the phone put down) counts as this much time spent on one card. */
export const MAX_ANSWER_DURATION_MS = 60_000

export type StudySessionParams = {
  deck: string | null
  practice: boolean
  /** "Repeat these now" (S-12): practice the cards failed in this finished session. */
  repeat: string | null
}

/** A study session saved to `meta.study_session` after every answer, so it survives a reload. */
export type StudySessionSnapshot = StudySessionParams & {
  id: string
  /** Remaining queue; the first item is the current card. */
  queue: QueueItem[]
  /** Answers given in this session, oldest first (an undone answer is removed). */
  log_ids: string[]
  /** One level of undo: the last answer and the queue before it. */
  undo: { log_id: string; queue: QueueItem[] } | null
  started_at: number
  last_active_at: number
  finished_at: number | null
}

export function newSnapshot(
  id: string,
  params: StudySessionParams,
  queue: QueueItem[],
  now: number,
): StudySessionSnapshot {
  return {
    ...params,
    id,
    queue,
    log_ids: [],
    undo: null,
    started_at: now,
    last_active_at: now,
    finished_at: null,
  }
}

/** The saved session continues when it is unfinished, for the same deck and mode, and was active < 30 min ago. */
export function canResume(
  saved: StudySessionSnapshot | null | undefined,
  params: StudySessionParams,
  now: number,
): saved is StudySessionSnapshot {
  return (
    saved != null &&
    saved.finished_at === null &&
    saved.queue.length > 0 &&
    saved.deck === params.deck &&
    saved.practice === params.practice &&
    saved.repeat === params.repeat &&
    now - saved.last_active_at < RESUME_WITHIN_MS
  )
}

export type AnsweredCard = { log_id: string; nextDue: number; reinsert: boolean }

/** Removes the current card after an answer; a short learning step puts it back later in the queue. */
export function applyAnswer(
  snapshot: StudySessionSnapshot,
  { log_id, nextDue, reinsert }: AnsweredCard,
  now: number,
): StudySessionSnapshot {
  const [current, ...rest] = snapshot.queue
  if (!current) return snapshot
  const queue = reinsert ? reinsertLearning(rest, current, nextDue, now) : rest
  return {
    ...snapshot,
    queue,
    log_ids: [...snapshot.log_ids, log_id],
    undo: { log_id, queue: snapshot.queue },
    last_active_at: now,
    finished_at: queue.length === 0 ? now : null,
  }
}

/** Puts the undone card back on top (UC-17). */
export function applyUndo(snapshot: StudySessionSnapshot, now: number): StudySessionSnapshot {
  if (!snapshot.undo) return snapshot
  const { log_id, queue } = snapshot.undo
  return {
    ...snapshot,
    queue,
    log_ids: snapshot.log_ids.filter((id) => id !== log_id),
    undo: null,
    last_active_at: now,
    finished_at: null,
  }
}

/** Drops the current card without an answer (it was deleted meanwhile). */
export function skipCurrent(snapshot: StudySessionSnapshot, now: number): StudySessionSnapshot {
  const queue = snapshot.queue.slice(1)
  return { ...snapshot, queue, last_active_at: now, finished_at: queue.length === 0 ? now : null }
}

export type SessionProgress = { done: number; total: number; counts: Record<QueueItemKind, number> }

/**
 * Progress for the top bar: answers given out of answers given plus cards left, so a card that returns for a
 * learning step adds to the total. Counters "New · Learning · Review" describe the cards left.
 */
export function sessionProgress(snapshot: StudySessionSnapshot): SessionProgress {
  const counts: Record<QueueItemKind, number> = { new: 0, learning: 0, review: 0 }
  for (const item of snapshot.queue) counts[item.kind]++
  const done = snapshot.log_ids.length
  return { done, total: done + snapshot.queue.length, counts }
}
