import { normalizeFront } from './normalize'
import type { Card, CardState } from './types'

/** A card with its non-deleted states in the deck's active directions. */
export type CardWithStates = { card: Card; states: CardState[] }

export type StateFilter = 'new' | 'learning' | 'review' | 'difficult'
export type CardSort = 'added_desc' | 'due_asc' | 'alpha' | 'difficulty_desc'
/** Summary status of a card for its status dot. */
export type CardStatus = 'new' | 'learning' | 'review'

/** A card is "difficult" when it lapsed at least this many times in any direction (S-06). */
export const DIFFICULT_LAPSES = 3

/**
 * Whether a card matches a state filter. With two directions a card can match several filters.
 * `learning` includes Relearning.
 */
export function matchesFilter({ states }: CardWithStates, filter: StateFilter): boolean {
  switch (filter) {
    case 'new':
      return states.length === 0 || states.some((s) => s.state === 0)
    case 'learning':
      return states.some((s) => s.state === 1 || s.state === 3)
    case 'review':
      return states.some((s) => s.state === 2)
    case 'difficult':
      return states.some((s) => s.lapses >= DIFFICULT_LAPSES)
  }
}

/** Case-, whitespace- and Unicode-form-insensitive substring search over front, back, example and tags. */
export function matchesSearch({ card }: CardWithStates, query: string): boolean {
  const needle = normalizeFront(query)
  if (needle === '') return true
  return [card.front, card.back, card.example ?? '', ...card.tags].some((text) => normalizeFront(text).includes(needle))
}

/** Most urgent status among the directions: learning, then review, then new. */
export function cardStatus({ states }: CardWithStates): CardStatus {
  if (states.some((s) => s.state === 1 || s.state === 3)) return 'learning'
  if (states.some((s) => s.state === 2)) return 'review'
  return 'new'
}

/** Earliest due time of the started (non-New) directions; `null` when the card was never studied. */
export function nextDue({ states }: CardWithStates): number | null {
  const started = states.filter((s) => s.state !== 0)
  return started.length === 0 ? null : Math.min(...started.map((s) => s.due))
}

function maxDifficulty({ states }: CardWithStates): number {
  return Math.max(0, ...states.map((s) => s.difficulty))
}

/** One collator for every comparison: `localeCompare` sets one up per call (seconds for 10 000 cards in WebKit). */
const collator = new Intl.Collator()

const comparators: Record<CardSort, (a: CardWithStates, b: CardWithStates) => number> = {
  added_desc: (a, b) => b.card.created_at - a.card.created_at,
  due_asc: (a, b) => (nextDue(a) ?? Number.POSITIVE_INFINITY) - (nextDue(b) ?? Number.POSITIVE_INFINITY),
  alpha: (a, b) => collator.compare(a.card.front, b.card.front),
  difficulty_desc: (a, b) => maxDifficulty(b) - maxDifficulty(a),
}

export type CardQuery = { search?: string; filter?: StateFilter | null; tag?: string | null; sort: CardSort }

/** Applies search, state filter, tag filter and sort (stable; ties keep the newest card first). */
export function queryCards(items: CardWithStates[], { search = '', filter, tag, sort }: CardQuery): CardWithStates[] {
  return items
    .filter((item) => matchesSearch(item, search))
    .filter((item) => !filter || matchesFilter(item, filter))
    .filter((item) => !tag || item.card.tags.includes(tag))
    .sort((a, b) => comparators[sort](a, b) || comparators.added_desc(a, b))
}

/** Card counts for the stats strip (New · Learning · Review · Difficult). */
export function countByFilter(items: CardWithStates[]): Record<StateFilter, number> {
  const counts: Record<StateFilter, number> = { new: 0, learning: 0, review: 0, difficult: 0 }
  for (const item of items) {
    for (const filter of Object.keys(counts) as StateFilter[]) if (matchesFilter(item, filter)) counts[filter] += 1
  }
  return counts
}

/** Distinct tags of the given cards, sorted. */
export function tagsOf(items: CardWithStates[]): string[] {
  return [...new Set(items.flatMap((item) => item.card.tags))].sort((a, b) => a.localeCompare(b))
}
