import {
  default_w,
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

/** FSRS-6 parameters: what ts-fsrs 5 takes and the server's optimizer (`fsrs` 6.6) returns. */
export const FSRS_PARAMETER_COUNT = default_w.length

/** Weights ts-fsrs can use: exactly `FSRS_PARAMETER_COUNT` finite numbers. */
export function validWeights(weights: unknown): weights is number[] {
  return (
    Array.isArray(weights) &&
    weights.length === FSRS_PARAMETER_COUNT &&
    weights.every((w) => typeof w === 'number' && Number.isFinite(w))
  )
}

/**
 * The FSRS scheduler for the user's settings: desired retention, optimized weights when present and valid (P4-T05;
 * invalid ones fall back to the defaults with a warning), learning/relearning steps and fuzz on.
 */
export function createScheduler(settings: Pick<Settings, 'desired_retention' | 'fsrs_weights'>): FSRS {
  const weights = settings.fsrs_weights
  const useWeights = weights !== null && validWeights(weights)
  if (weights !== null && !useWeights) {
    console.warn(`FSRS weights ignored: expected ${FSRS_PARAMETER_COUNT} numbers, using the defaults`)
  }
  return fsrs(
    generatorParameters({
      request_retention: settings.desired_retention,
      maximum_interval: MAXIMUM_INTERVAL,
      enable_fuzz: true,
      enable_short_term: true,
      ...(useWeights ? { w: weights } : {}),
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
