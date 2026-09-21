import { expect, type Page, test } from '@playwright/test'
import { buildSession } from '../../src/domain/session'
import type { Card, CardState, Deck } from '../../src/domain/types'
import { cardRow, deckRow, newStateRow, seed, setUpApp } from './helpers'

// Phase 1 acceptance: "Next day the due queue contains the expected cards". The clock is mocked: study 10 new
// cards today, move to the next study day, and Today must count exactly what the session builder queues.

test.use({ timezoneId: 'Europe/Riga' })

const WORDS = Array.from({ length: 10 }, (_, i) => `word ${i + 1}`)
const STUDY_DAY = new Date('2026-03-10T10:00:00+02:00')
/** 05:00 on the next day, after the default `day_start_hour` (04:00). */
const NEXT_DAY = new Date('2026-03-11T05:00:00+02:00')
const DAY_AFTER = new Date('2026-03-12T12:00:00+02:00')

async function readAll(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('annette')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const all = (store: string) =>
      new Promise<unknown[]>((resolve, reject) => {
        const request = db.transaction(store).objectStore(store).getAll()
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
    const [decks, cards, states] = [await all('decks'), await all('cards'), await all('card_states')]
    db.close()
    return { decks, cards, states }
  })
}

test('the next study day queues exactly the cards that became due', async ({ page }) => {
  await page.clock.install({ time: STUDY_DAY })
  await setUpApp(page)
  await seed(page, {
    decks: [deckRow('d1', 'English', { directions: 'forward' })],
    cards: WORDS.map((word, i) => cardRow(`c${i}`, 'd1', word, `${word} ru`, { created_at: i + 1 })),
    card_states: WORDS.map((_, i) => newStateRow(`c${i}`)),
  })

  await page.goto('/study?deck=d1')
  await page.getByRole('button', { name: 'Start' }).click()
  const progress = page.getByTestId('study-progress')
  for (let answers = 0; answers < 60 && !page.url().includes('/study/summary'); answers++) {
    const before = await progress.textContent()
    await page.getByRole('button', { name: 'Know', exact: true }).click()
    await expect(async () => {
      expect(page.url().includes('/study/summary') || (await progress.textContent()) !== before).toBe(true)
    }).toPass()
  }
  await expect(page).toHaveURL(/\/study\/summary/)
  await page.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByText('Nothing due.')).toBeVisible()

  // After two Know answers every card graduates to a review two days later, so the next study day is empty and
  // the day after that queues all ten. Both days must match the session builder exactly.
  expect(await openTodayAt(page, NEXT_DAY)).toBe(0)
  expect(await openTodayAt(page, DAY_AFTER)).toBe(WORDS.length)
})

/** Moves the clock, reopens Today and checks its due count against `buildSession`; returns that count. */
async function openTodayAt(page: Page, time: Date): Promise<number> {
  await page.clock.setSystemTime(time)
  const { decks, cards, states } = (await readAll(page)) as { decks: Deck[]; cards: Card[]; states: CardState[] }
  const now = time.getTime()
  // Every card was learned on the first day, so nothing is new and no answer belongs to a later study day.
  expect(states.every((state) => state.state !== 0)).toBe(true)
  const queue = buildSession(
    { decks, cards, states, logsToday: [], settings: { new_per_day: 15, max_reviews_per_day: 200 }, extraNew: 0 },
    now,
  )
  const expected = states.filter((state) => state.due <= now).map((state) => state.card_id)
  expect(queue.map((item) => item.card_id).sort()).toEqual(expected.sort())

  // Today reads the clock when it mounts: open it again.
  await page.getByRole('link', { name: 'Decks' }).click()
  await page.getByRole('link', { name: 'Today' }).click()
  if (expected.length === 0) {
    await expect(page.getByText('Nothing due.')).toBeVisible()
  } else {
    await expect(page.getByText(`To review: ${expected.length}`)).toBeVisible()
  }
  return expected.length
}
