import { v7 } from 'uuid'

/** A new UUIDv7: time-ordered, so ids sort by creation time (architecture invariant). */
export function newId(): string {
  return v7()
}
