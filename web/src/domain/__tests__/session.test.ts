import { describe, expect, it } from 'vitest'
import { estimateMinutes } from '../estimate'
import { buildSession, type QueueItem, reinsertLearning, type SessionInput } from '../session'
import { card, deck, log, review, settings, state } from './fixtures'

const NOW = new Date(2026, 8, 21, 12, 0).getTime()
const HOUR = 3_600_000

function input(extra: Partial<SessionInput>): SessionInput {
  return { decks: [], cards: [], states: [], logsToday: [], settings, extraNew: 0, ...extra }
}

/** `count` cards in `deck_id`, forward only, created in order. */
function cards(prefix: string, deck_id: string, count: number) {
  return Array.from({ length: count }, (_, i) =>
    card(`${prefix}${String(i).padStart(2, '0')}`, deck_id, { created_at: i }),
  )
}

const kinds = (queue: QueueItem[]) => queue.map((item) => (item.kind === 'new' ? 'N' : 'R')).join('')

describe('buildSession — queue order and limits', () => {
  it('puts due reviews first, oldest first, and one new card after every 4 reviews', () => {
    const reviewed = cards('r', 'd', 30)
    const fresh = cards('n', 'd', 20)
    const queue = buildSession(
      input({
        decks: [deck('d')],
        cards: [...reviewed, ...fresh],
        states: [...reviewed.map((c, i) => review(c.id, NOW - (30 - i) * HOUR)), ...fresh.map((c) => state(c.id))],
      }),
      NOW,
    )

    expect(kinds(queue)).toBe(`${'RRRRN'.repeat(7)}RR${'N'.repeat(8)}`)
    expect(queue.filter((item) => item.kind === 'new')).toHaveLength(15)
    expect(queue.filter((item) => item.kind === 'review').map((item) => item.card_id)).toEqual(
      reviewed.map((c) => c.id),
    )
    expect(queue.filter((item) => item.kind === 'new').map((item) => item.card_id)).toEqual(
      fresh.slice(0, 15).map((c) => c.id),
    )
  })

  it('keeps reviews that are not due yet out of the queue', () => {
    const [due, later] = cards('r', 'd', 2)
    const queue = buildSession(
      input({
        decks: [deck('d')],
        cards: [due, later].filter((c) => c !== undefined),
        states: [review('r00', NOW - 1), review('r01', NOW + 1)],
      }),
      NOW,
    )
    expect(queue.map((item) => item.card_id)).toEqual(['r00'])
  })

  it('allows only the reviews left under the daily maximum', () => {
    const reviewed = cards('r', 'd', 10)
    const other = cards('o', 'd', 195)
    const queue = buildSession(
      input({
        decks: [deck('d')],
        cards: [...reviewed, ...other],
        states: reviewed.map((c) => review(c.id, NOW - HOUR)),
        logsToday: other.map((c) => log(c.id, NOW - 2 * HOUR, { state_before: { ...review(c.id, 0) } })),
      }),
      NOW,
    )
    expect(queue).toHaveLength(5)
  })

  it('applies a deck override of new_per_day while another deck uses the global limit', () => {
    const small = cards('s', 'small', 20)
    const big = cards('b', 'big', 20)
    const queue = buildSession(
      input({
        decks: [deck('small', { new_per_day: 5 }), deck('big')],
        cards: [...small, ...big],
        states: [...small, ...big].map((c) => state(c.id)),
        settings: { new_per_day: 30, max_reviews_per_day: 200 },
      }),
      NOW,
    )
    expect(queue.filter((item) => item.card_id.startsWith('s'))).toHaveLength(5)
    expect(queue.filter((item) => item.card_id.startsWith('b'))).toHaveLength(20)
  })

  it('counts new cards introduced today against the limits', () => {
    const fresh = cards('n', 'd', 20)
    const queue = buildSession(
      input({
        decks: [deck('d')],
        cards: fresh,
        states: fresh.slice(10).map((c) => state(c.id)),
        logsToday: fresh.slice(0, 10).map((c) => log(c.id, NOW - HOUR)),
      }),
      NOW,
    )
    expect(queue).toHaveLength(5)
  })

  it('does not count undone answers', () => {
    const fresh = cards('n', 'd', 20)
    const queue = buildSession(
      input({
        decks: [deck('d')],
        cards: fresh,
        states: fresh.map((c) => state(c.id)),
        logsToday: [log('x', NOW - HOUR, { deleted_at: NOW - HOUR })],
      }),
      NOW,
    )
    expect(queue).toHaveLength(15)
  })

  it('limits the queue to one deck, with limits still counted over all decks', () => {
    const a = cards('a', 'A', 20)
    const b = cards('b', 'B', 20)
    const queue = buildSession(
      input({
        decks: [deck('A'), deck('B')],
        cards: [...a, ...b],
        states: [...a, ...b].map((c) => state(c.id)),
        logsToday: b.slice(0, 10).map((c) => log(c.id, NOW - HOUR)),
        deckFilter: 'A',
      }),
      NOW,
    )
    expect(queue.every((item) => item.card_id.startsWith('a'))).toBe(true)
    expect(queue).toHaveLength(5)
  })
})

describe('buildSession — eligibility', () => {
  it('excludes archived decks, deleted decks, deleted cards, deleted states and disabled directions', () => {
    const queue = buildSession(
      input({
        decks: [
          deck('live', { directions: 'forward' }),
          deck('archived', { archived_at: 1 }),
          deck('gone', { deleted_at: 1 }),
        ],
        cards: [
          card('ok', 'live'),
          card('deleted', 'live', { deleted_at: 1 }),
          card('in-archived', 'archived'),
          card('in-gone', 'gone'),
          card('state-deleted', 'live'),
        ],
        states: [
          state('ok'),
          state('ok', { direction: 'reverse' }),
          state('deleted'),
          state('in-archived'),
          state('in-gone'),
          state('state-deleted', { deleted_at: 1 }),
        ],
      }),
      NOW,
    )
    expect(queue).toEqual([{ card_id: 'ok', direction: 'forward', kind: 'new' }])
  })
})

describe('buildSession — sibling burying', () => {
  it('shows only one direction of a new card per day', () => {
    const queue = buildSession(
      input({
        decks: [deck('d', { directions: 'both' })],
        cards: [card('c', 'd')],
        states: [state('c'), state('c', { direction: 'reverse' })],
      }),
      NOW,
    )
    expect(queue).toEqual([{ card_id: 'c', direction: 'forward', kind: 'new' }])
  })

  it('buries a due review when the other direction was answered today', () => {
    const queue = buildSession(
      input({
        decks: [deck('d', { directions: 'both' })],
        cards: [card('c', 'd')],
        states: [review('c', NOW - HOUR, { direction: 'reverse' })],
        logsToday: [log('c', NOW - 2 * HOUR, { direction: 'forward' })],
      }),
      NOW,
    )
    expect(queue).toEqual([])
  })

  it('keeps a learning step even when the sibling was answered today', () => {
    const queue = buildSession(
      input({
        decks: [deck('d', { directions: 'both' })],
        cards: [card('c', 'd')],
        states: [state('c', { direction: 'reverse', state: 1, due: NOW - 60_000 })],
        logsToday: [log('c', NOW - HOUR, { direction: 'forward' })],
      }),
      NOW,
    )
    expect(queue).toEqual([{ card_id: 'c', direction: 'reverse', kind: 'learning' }])
  })
})

describe('buildSession — extra new words', () => {
  it('allows 10 more new cards when the day limit is used up', () => {
    const fresh = cards('n', 'd', 40)
    const base = {
      decks: [deck('d')],
      cards: fresh,
      states: fresh.slice(15).map((c) => state(c.id)),
      logsToday: fresh.slice(0, 15).map((c) => log(c.id, NOW - HOUR)),
    }
    expect(buildSession(input(base), NOW)).toHaveLength(0)
    expect(buildSession(input({ ...base, extraNew: 10 }), NOW)).toHaveLength(10)
  })
})

describe('reinsertLearning', () => {
  const queue: QueueItem[] = Array.from({ length: 20 }, (_, i) => ({
    card_id: `q${i}`,
    direction: 'forward',
    kind: 'review',
  }))
  const item: QueueItem = { card_id: 'x', direction: 'forward', kind: 'new' }

  it('puts a card due in 1 minute back about 6 cards later', () => {
    const result = reinsertLearning(queue, item, NOW + 60_000, NOW)
    expect(result).toHaveLength(21)
    expect(result[6]).toEqual({ card_id: 'x', direction: 'forward', kind: 'learning' })
  })

  it('appends a card whose due time is after the end of the queue', () => {
    const result = reinsertLearning(queue, item, NOW + 15 * 60_000, NOW)
    expect(result.at(-1)?.card_id).toBe('x')
  })

  it('does not reinsert a card due in a day', () => {
    expect(reinsertLearning(queue, item, NOW + 86_400_000, NOW)).toBe(queue)
  })
})

describe('estimateMinutes', () => {
  it('uses about 8 s per review and 15 s per new card', () => {
    const queue: QueueItem[] = [
      ...Array.from({ length: 30 }, (): QueueItem => ({ card_id: 'r', direction: 'forward', kind: 'review' })),
      ...Array.from({ length: 12 }, (): QueueItem => ({ card_id: 'n', direction: 'forward', kind: 'new' })),
    ]
    expect(estimateMinutes(queue)).toBe(7)
    expect(estimateMinutes([])).toBe(0)
  })
})
