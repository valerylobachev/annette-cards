import { type TargetAndTransition, type Transition, useReducedMotion } from 'motion/react'

// All study-card motion in one place. With `prefers-reduced-motion` the flip, tilt, fly-out and stack movement
// become cross-fades (ui_ux.md §2 "Motion", §8).

/** Maximum tilt of a dragged card, in degrees. */
export const MAX_TILT_DEG = 12
/** How far a committed card flies, as a multiple of the card area size. */
export const FLY_DISTANCE = 1.5

export const flipTransition: Transition = { duration: 0.25, ease: 'easeInOut' }
export const springBack: Transition = { type: 'spring', stiffness: 500, damping: 35 }
export const flyOut: Transition = { duration: 0.22, ease: 'easeIn' }
export const stackTransition: Transition = { type: 'spring', stiffness: 400, damping: 32 }
const fade: Transition = { duration: 0.2, ease: 'easeInOut' }

/**
 * Position of the card at `depth` in the stack: 0 is the current card, 1 and 2 are behind it. Scaled from the
 * bottom edge (`origin-bottom`), so each card behind shows an 8 px strip below the one in front.
 */
export const stackLayer = (depth: number) => ({ scale: 1 - depth * 0.05, y: depth * 8 })

export type StudyMotion = {
  reduced: boolean
  maxTilt: number
  flip: Transition
  /** How the card leaves after an answer: flying away, or fading in place. */
  leave: Transition
  /** How the next card takes the top of the stack. */
  enter: { initial: TargetAndTransition; animate: TargetAndTransition; transition: Transition }
}

export function useStudyMotion(): StudyMotion {
  const reduced = useReducedMotion() ?? false
  return reduced
    ? {
        reduced,
        maxTilt: 0,
        flip: fade,
        leave: fade,
        enter: { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: fade },
      }
    : {
        reduced,
        maxTilt: MAX_TILT_DEG,
        flip: flipTransition,
        leave: flyOut,
        enter: { initial: stackLayer(1), animate: stackLayer(0), transition: stackTransition },
      }
}
