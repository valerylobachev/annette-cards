import { beforeAll, describe, expect, it } from 'vitest'
import { buildSession } from '@/domain/session'
import type { Card, CardState, Deck, ReviewLog } from '@/domain/types'
import { resetDb } from '@/test/db'
import { generateStudyData } from '../../tests/fixtures/bigDeck'
import { db } from './schema'
import { loadSession, loadSessionInput } from './studyQueries'

// P4-T06 performance pass: a 10 000-card deck in both directions with 100 000 answers.
const NOW = new Date(2026, 8, 21, 12).getTime()
const RUNS = 7

async function medianMs(run: () => Promise<unknown> | unknown): Promise<number> {
  const times: number[] = []
  for (let i = 0; i < RUNS; i++) {
    const start = performance.now()
    await run()
    times.push(performance.now() - start)
  }
  times.sort((a, b) => a - b)
  return Math.round((times[Math.floor(RUNS / 2)] ?? 0) * 10) / 10
}

describe('10 000-card deck', () => {
  beforeAll(async () => {
    await resetDb()
    const rows = generateStudyData({ now: NOW })
    await db.transaction('rw', [db.decks, db.cards, db.card_states, db.review_log], async () => {
      await db.decks.bulkPut(rows.decks as unknown as Deck[])
      await db.cards.bulkPut(rows.cards as unknown as Card[])
      await db.card_states.bulkPut(rows.card_states as unknown as CardState[])
      await db.review_log.bulkPut(rows.review_log as unknown as ReviewLog[])
    })
  }, 60_000)

  it('builds the study session in under 100 ms', async () => {
    const queue = await loadSession(NOW)
    // 200 reviews (max_reviews_per_day) + 15 new (new_per_day).
    expect(queue.length).toBeLessThanOrEqual(215)
    expect(queue.filter((item) => item.kind === 'new')).toHaveLength(15)

    const input = await loadSessionInput(NOW)
    const build = await medianMs(() => buildSession(input, NOW))
    const load = await medianMs(() => loadSession(NOW))
    process.stdout.write(
      `\n[perf] session over 10 000 cards: build ${build} ms, read + build ${load} ms (median of ${RUNS})\n`,
    )
    expect(build).toBeLessThan(100)
    // fake-indexeddb, not a browser: a loose guard here; tests/e2e/performance.spec.ts checks < 100 ms in WebKit.
    expect(load).toBeLessThan(250)
  }, 60_000)
})
