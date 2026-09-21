import { normalizeFront } from './normalize'
import type { Card, Deck } from './types'

/** A random number in [0, 1), injected so tests are deterministic. */
export type Rng = () => number

/** Options of a multiple-choice question: the correct answer and three distractors (ui_ux.md S-11 Mode B). */
export const CHOICE_OPTIONS = 4

/** A copy of `items` in random order (Fisher–Yates). */
export function shuffle<T>(items: readonly T[], rng: Rng = Math.random): T[] {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const a = copy[i]
    const b = copy[j]
    if (a !== undefined && b !== undefined) {
      copy[i] = b
      copy[j] = a
    }
  }
  return copy
}

const lengthOf = (text: string) => Array.from(text).length

/**
 * Wrong options for a multiple-choice question about `target[field]` (architecture.md §4.4): cards of the same deck
 * first, then the most shared tags, then the most similar length; ties are broken at random. The target, deleted
 * cards and any value equal (after `normalizeFront`) to the answer or to an option already picked are skipped.
 * Returns fewer than `count` when the pool has no more distinct values; the caller decides what to do then.
 */
export function pickDistractors(
  target: Card,
  pool: Card[],
  field: 'front' | 'back',
  count = CHOICE_OPTIONS - 1,
  rng: Rng = Math.random,
): Card[] {
  const tags = new Set(target.tags)
  const length = lengthOf(target[field])
  const rank = (card: Card) => ({
    card,
    sameDeck: card.deck_id === target.deck_id ? 1 : 0,
    sharedTags: card.tags.filter((tag) => tags.has(tag)).length,
    lengthGap: Math.abs(lengthOf(card[field]) - length),
  })
  const ranked = shuffle(
    pool.filter((card) => card.id !== target.id && card.deleted_at === null),
    rng,
  )
    .map(rank)
    .sort((a, b) => b.sameDeck - a.sameDeck || b.sharedTags - a.sharedTags || a.lengthGap - b.lengthGap)

  const seen = new Set([normalizeFront(target[field])])
  const picked: Card[] = []
  for (const { card } of ranked) {
    if (picked.length === count) break
    const value = normalizeFront(card[field])
    if (value === '' || seen.has(value)) continue
    seen.add(value)
    picked.push(card)
  }
  return picked
}

export type ChoiceOption = { text: string; correct: boolean }

/** The shuffled options of a question about `target[field]`: the answer and up to three distractors. */
export function choiceOptions(
  target: Card,
  pool: Card[],
  field: 'front' | 'back',
  rng: Rng = Math.random,
): ChoiceOption[] {
  const distractors = pickDistractors(target, pool, field, CHOICE_OPTIONS - 1, rng)
  return shuffle(
    [{ text: target[field], correct: true }, ...distractors.map((card) => ({ text: card[field], correct: false }))],
    rng,
  )
}

/**
 * Multiple choice (and listening with written options) needs a studied language with at least four different
 * words among its active cards (UC-14): otherwise the Today chips are disabled. A session card whose language has
 * fewer still gets whatever options exist (ui_ux.md S-11 Mode B).
 */
export function choiceAvailable(decks: Deck[], cards: Card[]): boolean {
  const langOf = new Map(
    decks
      .filter((deck) => deck.deleted_at === null && deck.archived_at === null)
      .map((deck) => [deck.id, deck.target_lang]),
  )
  const words = new Map<string, Set<string>>()
  for (const card of cards) {
    const lang = langOf.get(card.deck_id)
    if (lang === undefined || card.deleted_at !== null) continue
    const set = words.get(lang) ?? new Set<string>()
    set.add(normalizeFront(card.front))
    words.set(lang, set)
    if (set.size >= CHOICE_OPTIONS) return true
  }
  return false
}
