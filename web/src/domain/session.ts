import { countedLogs } from './counters'
import { activeDirections } from './directions'
import type { Card, CardState, Deck, Direction, ReviewLog, Settings } from './types'

export type QueueItemKind = 'new' | 'learning' | 'review'
export type QueueItem = { card_id: string; direction: Direction; kind: QueueItemKind }

export type SessionInput = {
  decks: Deck[]
  cards: Card[]
  states: CardState[]
  /** Review logs of the current study day. */
  logsToday: ReviewLog[]
  settings: Pick<Settings, 'new_per_day' | 'max_reviews_per_day'>
  /** Extra new cards allowed today ("Learn extra new words"). */
  extraNew: number
  /** Limit the session to one deck. */
  deckFilter?: string
}

/** One new card after every this many reviews. */
export const REVIEWS_PER_NEW = 4

const kindOf = (state: CardState): QueueItemKind =>
  state.state === 0 ? 'new' : state.state === 2 ? 'review' : 'learning'

/**
 * The study queue (architecture.md §4.4 "Session queue"):
 * 1. eligible: live card in a live, non-archived deck, direction active for the deck, optional deck filter;
 * 2. due (Learning, Review, Relearning with `due <= now`), oldest first, up to the daily review limit;
 * 3. New, in card creation order, up to the per-deck limit (`deck.new_per_day ?? settings.new_per_day`) and the
 *    global limit `settings.new_per_day`, both raised by `extraNew`;
 * 4. one new card after every 4 reviews;
 * 5. siblings buried: a direction is skipped when the card's other direction was answered today or is already
 *    queued. Learning/Relearning states are never buried, so learning steps continue.
 */
export function buildSession(input: SessionInput, now: number): QueueItem[] {
  const { cards, settings, extraNew } = input
  const { liveDecks, cardById, eligible } = eligibleStates(input)

  // Counters over all decks: the daily limits are global, the deck filter only narrows the queue.
  const logs = countedLogs(input.logsToday)
  const answeredToday = new Map<string, Set<Direction>>()
  const newByDeck = new Map<string, number>()
  let newIntroduced = 0
  let reviewsDone = 0
  const deckOfCard = new Map(cards.map((card) => [card.id, card.deck_id]))
  for (const log of logs) {
    const directions = answeredToday.get(log.card_id) ?? new Set<Direction>()
    directions.add(log.direction)
    answeredToday.set(log.card_id, directions)
    if (log.state_before.state === 0) {
      newIntroduced++
      const deck_id = deckOfCard.get(log.card_id)
      if (deck_id) newByDeck.set(deck_id, (newByDeck.get(deck_id) ?? 0) + 1)
    } else {
      reviewsDone++
    }
  }

  const queued = new Set<string>()
  const buried = (state: CardState) => {
    const answered = answeredToday.get(state.card_id)
    const siblingAnswered = answered !== undefined && [...answered].some((d) => d !== state.direction)
    return siblingAnswered || queued.has(state.card_id)
  }

  const due: QueueItem[] = []
  let reviewRoom = settings.max_reviews_per_day - reviewsDone
  const dueStates = eligible.filter((s) => s.state !== 0 && s.due <= now).sort((a, b) => a.due - b.due)
  for (const state of dueStates) {
    if (reviewRoom <= 0) break
    const learning = state.state === 1 || state.state === 3
    if (!learning && buried(state)) continue
    due.push({ card_id: state.card_id, direction: state.direction, kind: kindOf(state) })
    queued.add(state.card_id)
    reviewRoom--
  }

  const fresh: QueueItem[] = []
  let globalRoom = settings.new_per_day + extraNew - newIntroduced
  const deckRoom = new Map(
    [...liveDecks.values()].map((deck) => [
      deck.id,
      (deck.new_per_day ?? settings.new_per_day) + extraNew - (newByDeck.get(deck.id) ?? 0),
    ]),
  )
  const newStates = eligible.filter((s) => s.state === 0).sort((a, b) => compareNew(a, b, cardById))
  for (const state of newStates) {
    if (globalRoom <= 0) break
    const deck_id = cardById.get(state.card_id)?.deck_id ?? ''
    const room = deckRoom.get(deck_id) ?? 0
    if (room <= 0 || buried(state)) continue
    fresh.push({ card_id: state.card_id, direction: state.direction, kind: 'new' })
    queued.add(state.card_id)
    deckRoom.set(deck_id, room - 1)
    globalRoom--
  }

  return interleave(due, fresh)
}

/**
 * Step 0 of the queue: states of live cards in live, non-archived decks (optionally one deck) whose direction is
 * active for the deck.
 */
export function eligibleStates({ decks, cards, states, deckFilter }: SessionInput) {
  const liveDecks = new Map(
    decks
      .filter((deck) => deck.deleted_at === null && deck.archived_at === null)
      .filter((deck) => deckFilter === undefined || deck.id === deckFilter)
      .map((deck) => [deck.id, deck]),
  )
  const cardById = new Map(
    cards.filter((card) => card.deleted_at === null && liveDecks.has(card.deck_id)).map((card) => [card.id, card]),
  )
  const eligible = states.filter((state) => {
    const card = cardById.get(state.card_id)
    const deck = card && liveDecks.get(card.deck_id)
    return (
      state.deleted_at === null && deck !== undefined && activeDirections(deck.directions).includes(state.direction)
    )
  })
  return { liveDecks, cardById, eligible }
}

/** Card creation order; the UUIDv7 id breaks ties (cards imported in one batch share `created_at`). */
function compareNew(a: CardState, b: CardState, cards: Map<string, Card>): number {
  const cardA = cards.get(a.card_id)
  const cardB = cards.get(b.card_id)
  const byCreated = (cardA?.created_at ?? 0) - (cardB?.created_at ?? 0)
  if (byCreated !== 0) return byCreated
  if (a.card_id !== b.card_id) return a.card_id < b.card_id ? -1 : 1
  return a.direction === 'forward' ? -1 : 1
}

function interleave(due: QueueItem[], fresh: QueueItem[]): QueueItem[] {
  const queue: QueueItem[] = []
  let n = 0
  for (const [i, item] of due.entries()) {
    queue.push(item)
    if ((i + 1) % REVIEWS_PER_NEW === 0 && n < fresh.length) queue.push(fresh[n++] as QueueItem)
  }
  return [...queue, ...fresh.slice(n)]
}

/** Re-insert only answers whose next step is due sooner than this (architecture.md §4.4 step 5). */
export const REINSERT_WITHIN_MS = 20 * 60_000
/** Approximate time per card, used to place a re-inserted card at its due time. */
export const SECONDS_PER_CARD = 10

/**
 * After an answer with a short next interval, puts the card back into the remaining queue where its due time
 * falls, assuming about 10 s per card; a longer interval leaves the queue unchanged (the card stays due).
 */
export function reinsertLearning(queue: QueueItem[], item: QueueItem, nextDue: number, now: number): QueueItem[] {
  const wait = nextDue - now
  if (wait >= REINSERT_WITHIN_MS) return queue
  const position = Math.min(queue.length, Math.max(0, Math.ceil(wait / 1000 / SECONDS_PER_CARD)))
  return [...queue.slice(0, position), { ...item, kind: 'learning' }, ...queue.slice(position)]
}
