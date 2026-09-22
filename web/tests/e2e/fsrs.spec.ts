import { expect, test } from '@playwright/test'
import { cardRow, deckRow, newStateRow, readRow, seed, setUpApp } from './helpers'

const DAY = 86_400_000
// The ts-fsrs 5.4 defaults with w8 × 1.5 (faster stability growth), as an optimization might return.
const WEIGHTS = [
  0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 2.8083, 0.1666, 0.796, 1.4835, 0.0614, 0.2629, 1.6483,
  0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542,
]

test('optimized weights show in Settings and schedule answers offline; Optimize needs a connection', async ({
  page,
  context,
}) => {
  await setUpApp(page)
  await context.setOffline(true)
  const lastReview = Date.now() - 10 * DAY
  await seed(page, {
    // A signed-in device (offline, so nothing reaches a server).
    meta: [
      { key: 'account', value: { user_id: 'u1', email: 'anna@example.com', display_name: 'Anna', is_admin: false } },
    ],
    settings: [
      { id: 'user', fsrs_weights: WEIGHTS, fsrs_optimized_at: Date.UTC(2026, 8, 20), updated_at: 1, updated_by: 'e2e' },
    ],
    decks: [deckRow('d1', 'English', { directions: 'forward' })],
    cards: [cardRow('c1', 'd1', 'cat', 'кот')],
    card_states: [
      newStateRow('c1', 'forward', {
        state: 2,
        due: Date.now() - 60_000,
        stability: 10,
        difficulty: 5,
        scheduled_days: 10,
        reps: 3,
        last_review: lastReview,
      }),
    ],
  })

  await page.getByRole('link', { name: 'Settings' }).click()
  await expect(page.getByText('Optimized on 9/20/2026')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Optimize' })).toBeDisabled()
  await expect(page.getByText('Available online').first()).toBeVisible()

  await page.getByRole('link', { name: 'Today' }).click()
  await page.getByRole('button', { name: 'Start' }).click()
  await page.getByRole('button', { name: 'Start' }).click()
  await page.getByRole('button', { name: 'Know', exact: true }).click()
  await expect(page).toHaveURL(/\/study\/summary/)
  const state = await page.evaluate(
    () =>
      new Promise<{ state: number; stability: number }>((resolve) => {
        const request = indexedDB.open('annette')
        request.onsuccess = () => {
          const get = request.result.transaction('card_states').objectStore('card_states').get(['c1', 'forward'])
          get.onsuccess = () => resolve(get.result)
        }
      }),
  )
  // Good after 10 days: stability 32 days with the default weights, 66 with these.
  expect(state.state).toBe(2)
  expect(state.stability).toBeGreaterThan(60)

  await page.getByRole('button', { name: 'Done' }).click()
  await page.getByRole('link', { name: 'Settings' }).click()
  await page.getByRole('button', { name: 'Reset to default' }).click()
  await expect(page.getByText('Default', { exact: true })).toBeVisible()
  expect(await readRow(page, 'settings', 'user')).toMatchObject({ fsrs_weights: null, fsrs_optimized_at: null })
})
