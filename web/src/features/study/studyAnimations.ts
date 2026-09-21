import type { Transition } from 'motion/react'

// All study-card motion in one place, so reduced-motion variants (cross-fades) can replace them together.

/** Maximum tilt of a dragged card, in degrees. */
export const MAX_TILT_DEG = 12

export const flipTransition: Transition = { duration: 0.25, ease: 'easeInOut' }
export const springBack: Transition = { type: 'spring', stiffness: 500, damping: 35 }
export const flyOut: Transition = { duration: 0.22, ease: 'easeIn' }
export const stackTransition: Transition = { type: 'spring', stiffness: 400, damping: 32 }

/**
 * Position of the card at `depth` in the stack: 0 is the current card, 1 and 2 are behind it. Scaled from the
 * bottom edge (`origin-bottom`), so each card behind shows an 8 px strip below the one in front.
 */
export const stackLayer = (depth: number) => ({ scale: 1 - depth * 0.05, y: depth * 8 })

/** How far a committed card flies, as a multiple of the card area size. */
export const FLY_DISTANCE = 1.5
