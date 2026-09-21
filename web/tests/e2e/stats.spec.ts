import { expect, test } from '@playwright/test'
import { cardRow, deckRow, newStateRow, seed, setUpApp } from './helpers'

const DAY = 86_400_000

/** A review answered `daysAgo` study days ago at noon (well inside the study day). */
function logRow(id: string, card_id: string, daysAgo: number, rating: number) {
  const noon = new Date()
  noon.setHours(12, 0, 0, 0)
  return {
    id,
    card_id,
    direction: 'forward',
    rating,
    mode: 'swipe',
    state_before: {
      state: 2,
      due: 0,
      stability: 10,
      difficulty: 5,
      elapsed_days: 3,
      scheduled_days: 3,
      learning_steps: 0,
      reps: 3,
      lapses: 0,
      last_review: 0,
    },
    reviewed_at: noon.getTime() - daysAgo * DAY,
    duration_ms: 20_000,
    practice: false,
    updated_at: 1,
    updated_by: 'e2e',
    deleted_at: null,
  }
}

test('statistics show KPIs, charts and the year heatmap offline', async ({ page, context }, testInfo) => {
  await setUpApp(page)
  const words = ['one', 'two', 'three', 'four']
  await seed(page, {
    decks: [deckRow('d1', 'English', { directions: 'forward' })],
    cards: words.map((word, i) => cardRow(`c${i}`, 'd1', word, `${word}-ru`)),
    card_states: words.map((_, i) =>
      newStateRow(`c${i}`, 'forward', { state: 2, due: Date.now() + (i + 1) * DAY, scheduled_days: i * 10 }),
    ),
    review_log: [
      logRow('l1', 'c0', 0, 3),
      logRow('l2', 'c1', 0, 1),
      logRow('l3', 'c2', 1, 4),
      logRow('l4', 'c3', 2, 3),
      logRow('l5', 'c0', 10, 2),
    ],
  })

  await page.goto('/stats')
  const kpis = page.getByRole('region', { name: 'Key numbers' })
  await expect(kpis).toContainText('Cards4')
  await expect(kpis).toContainText('Mature cards1')
  await expect(kpis).toContainText('Current streak3 days')
  await expect(page.getByText('5 answers in this period')).toBeVisible()
  await expect(page.getByText('60% of reviews answered Good or Easy (practice not counted)')).toBeVisible()

  await context.setOffline(true)
  await page.getByRole('button', { name: '1 year' }).click()
  await expect(page.getByTestId('heatmap')).toBeVisible()
  await expect(page.getByText('4 study days')).toBeVisible()
  await expect(page.getByRole('button', { name: '7 days' })).toBeVisible()
  const screenshot = await page.screenshot({ fullPage: true, path: process.env.STATS_SCREENSHOT })
  await testInfo.attach('statistics', { body: screenshot, contentType: 'image/png' })

  await page.getByRole('button', { name: '7 days' }).click()
  await expect(page.getByText('4 answers in this period')).toBeVisible()
})
