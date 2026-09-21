import {
  type FSRS,
  type Card as FsrsCard,
  type ReviewLog as FsrsReviewLog,
  fsrs,
  type Grade,
  generatorParameters,
} from 'ts-fsrs'
import type { CardState, CardStateSnapshot, FsrsState, Rating, Settings } from './types'

/** Longest interval FSRS may schedule, in days (architecture.md §4.4). */
export const MAXIMUM_INTERVAL = 36500

/**
 * The FSRS scheduler for the user's settings: desired retention, optimized weights when present (Phase 4),
 * learning/relearning steps and fuzz on.
 */
export function createScheduler(settings: Pick<Settings, 'desired_retention' | 'fsrs_weights'>): FSRS {
  return fsrs(
    generatorParameters({
      request_retention: settings.desired_retention,
      maximum_interval: MAXIMUM_INTERVAL,
      enable_fuzz: true,
      enable_short_term: true,
      ...(settings.fsrs_weights ? { w: settings.fsrs_weights } : {}),
    }),
  )
}

/** The scheduling fields of a state (what `review_log.state_before` stores). */
export function snapshotOf(state: CardStateSnapshot): CardStateSnapshot {
  return {
    state: state.state,
    due: state.due,
    stability: state.stability,
    difficulty: state.difficulty,
    elapsed_days: state.elapsed_days,
    scheduled_days: state.scheduled_days,
    learning_steps: state.learning_steps,
    reps: state.reps,
    lapses: state.lapses,
    last_review: state.last_review,
  }
}

export function toFsrsCard(state: CardStateSnapshot): FsrsCard {
  return {
    due: new Date(state.due),
    stability: state.stability,
    difficulty: state.difficulty,
    elapsed_days: state.elapsed_days,
    scheduled_days: state.scheduled_days,
    learning_steps: state.learning_steps,
    reps: state.reps,
    lapses: state.lapses,
    state: state.state,
    last_review: state.last_review === null ? undefined : new Date(state.last_review),
  }
}

export function fromFsrsCard(card: FsrsCard): CardStateSnapshot {
  return {
    state: card.state as FsrsState,
    due: card.due.getTime(),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsed_days,
    scheduled_days: card.scheduled_days,
    learning_steps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    last_review: card.last_review ? card.last_review.getTime() : null,
  }
}

/** The state after answering `rating` at `now`; identity and stamp fields are kept from `state`. */
export function nextState(
  scheduler: FSRS,
  state: CardState,
  rating: Rating,
  now: number,
): { state: CardState; log: FsrsReviewLog } {
  const { card, log } = scheduler.next(toFsrsCard(state), new Date(now), rating as Grade)
  return { state: { ...state, ...fromFsrsCard(card) }, log }
}
