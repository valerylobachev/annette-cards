import type { TypedVerdict } from './answer'
import type { AnswerMode, Rating } from './types'

export type SwipeDirection = 'left' | 'right' | 'up'

/** A horizontal swipe commits beyond this share of the card area width (ui_ux.md S-11 Mode A). */
export const SWIPE_COMMIT_SHARE_X = 0.35
/** Swipe up (detailed mode) commits beyond this share of the card area height. */
export const SWIPE_COMMIT_SHARE_Y = 0.3
/** A fling faster than this commits regardless of the distance, in px/s. */
export const SWIPE_COMMIT_VELOCITY = 600

type Vector = { x: number; y: number }

/**
 * The direction a drag commits to when released, or `null` to spring back. Swipe up counts only in detailed mode
 * and only when the drag is more vertical than horizontal.
 */
export function swipeOutcome(
  offset: Vector,
  velocity: Vector,
  size: { width: number; height: number },
  mode: AnswerMode,
): SwipeDirection | null {
  const upward = offset.y < 0 && Math.abs(offset.y) > Math.abs(offset.x)
  if (
    mode === 'detailed' &&
    upward &&
    (-offset.y > size.height * SWIPE_COMMIT_SHARE_Y || -velocity.y > SWIPE_COMMIT_VELOCITY)
  ) {
    return 'up'
  }
  const far = Math.abs(offset.x) > size.width * SWIPE_COMMIT_SHARE_X
  const fast = Math.abs(velocity.x) > SWIPE_COMMIT_VELOCITY && Math.sign(velocity.x) === Math.sign(offset.x)
  if (offset.x !== 0 && (far || fast)) return offset.x > 0 ? 'right' : 'left'
  return null
}

/** Swipe → FSRS rating (architecture.md §4.4): left Again, right Good, up Easy (detailed mode only). */
export function swipeRating(direction: SwipeDirection, mode: AnswerMode): Rating | null {
  if (direction === 'left') return 1
  if (direction === 'right') return 3
  return mode === 'detailed' ? 4 : null
}

/** The answer buttons under the card: ✗ / ✓ in simple mode, Again · Hard · Good · Easy in detailed mode. */
export function answerRatings(mode: AnswerMode): Rating[] {
  return mode === 'detailed' ? [1, 2, 3, 4] : [1, 3]
}

/** Typing → FSRS rating (architecture.md §4.4): exact Good, near miss Hard, wrong or "I don't know" Again. */
export function typedRating(verdict: TypedVerdict): Rating {
  if (verdict === 'exact') return 3
  return verdict === 'near' ? 2 : 1
}
