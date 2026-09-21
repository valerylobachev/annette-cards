let clock: () => number = () => Date.now()

/** Current time in ms since the epoch. Use this instead of `Date.now()` so tests can control time. */
export function now(): number {
  return clock()
}

/** Tests only: replace the clock; call without arguments to restore the real one. */
export function setClock(fn: () => number = () => Date.now()) {
  clock = fn
}
