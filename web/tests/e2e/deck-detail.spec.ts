import { expect, test } from '@playwright/test'
import { cardRow, deckRow, seed, useUiLanguage } from './helpers'

function stateRow(card_id: string, direction: string, extra: Record<string, unknown> = {}) {
  return {
    card_id,
    direction,
    state: 0,
    due: 1,
    stability: 0,
    difficulty: 0,
    elapsed_days: 0,
    scheduled_days: 0,
    learning_steps: 0,
    reps: 0,
    lapses: 0,
    last_review: null,
    updated_at: 1,
    updated_by: 'e2e',
    deleted_at: null,
    ...extra,
  }
}

const word = (i: number) => `word ${String(i).padStart(4, '0')}`

test.beforeEach(async ({ page }) => {
  await useUiLanguage(page)
  await page.goto('/decks')
})

test('a deck with 5 000 cards scrolls to the bottom without errors', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const cards = Array.from({ length: 5000 }, (_, i) =>
    cardRow(`c${i}`, 'big', word(i), `слово ${i}`, { created_at: i }),
  )
  await seed(page, {
    decks: [deckRow('big', 'Big deck', { directions: 'forward' })],
    cards,
    card_states: cards.map((card, i) =>
      stateRow(card.id as string, 'forward', i % 3 === 0 ? { state: 2, due: 10_000_000 + i, lapses: i % 7 } : {}),
    ),
  })
  await page.goto('/decks/big')
  const list = page.getByRole('list', { name: 'Cards' })
  await expect(list.getByText(word(4999))).toBeVisible()
  // Only the rows on screen are rendered.
  expect(await list.getByRole('listitem').count()).toBeLessThan(60)

  for (let i = 0; i < 20 && !(await list.getByText(word(0)).isVisible()); i++) {
    // Mobile WebKit has no wheel events; scroll the window in large steps like a fling would.
    await page.evaluate(() => window.scrollBy(0, 20_000))
    await page.waitForTimeout(100)
  }
  await expect(list.getByText(word(0))).toBeVisible()
  expect(errors).toEqual([])
})

test('multi-select three cards, delete them and undo', async ({ page }) => {
  await seed(page, {
    decks: [deckRow('d1', 'English')],
    cards: ['alpha', 'beta', 'gamma', 'delta'].map((w, i) => cardRow(w, 'd1', w, `${w}-ru`, { created_at: i })),
  })
  await page.goto('/decks/d1')
  const list = page.getByRole('list', { name: 'Cards' })
  await expect(list.getByText('alpha', { exact: true })).toBeVisible()

  // Long-press enters selection mode with the pressed card selected.
  const first = list.getByRole('link', { name: /^alpha/ })
  const box = await first.boundingBox()
  if (!box) throw new Error('row not visible')
  await page.mouse.move(box.x + 30, box.y + box.height / 2)
  await page.mouse.down()
  await page.waitForTimeout(700)
  await page.mouse.up()
  await expect(page.getByRole('heading', { name: '1 selected' })).toBeVisible()

  await page.getByRole('button', { name: 'Select beta' }).click()
  await page.getByRole('button', { name: 'Select gamma' }).click()
  await expect(page.getByRole('heading', { name: '3 selected' })).toBeVisible()

  await page
    .getByRole('toolbar', { name: 'Actions for selected cards' })
    .getByRole('button', { name: 'Delete' })
    .click()
  await page.getByRole('dialog', { name: 'Delete 3 cards?' }).getByRole('button', { name: 'Delete' }).click()
  await expect(list.getByText('delta', { exact: true })).toBeVisible()
  await expect(list.getByText('alpha', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('status')).toContainText('3 cards deleted')

  await page.getByRole('status').getByRole('button', { name: 'Undo' }).click()
  for (const name of ['alpha', 'beta', 'gamma', 'delta'])
    await expect(list.getByText(name, { exact: true })).toBeVisible()
})

test('filters, study buttons and the card view', async ({ page }) => {
  await seed(page, {
    decks: [deckRow('d1', 'English')],
    cards: [cardRow('hard', 'd1', 'hard word', 'трудное'), cardRow('easy', 'd1', 'easy word', 'лёгкое')],
    card_states: [
      stateRow('hard', 'forward', { state: 2, due: 5_000_000_000_000, lapses: 3, reps: 8, stability: 4.2 }),
      stateRow('hard', 'reverse'),
      stateRow('easy', 'forward'),
      stateRow('easy', 'reverse'),
    ],
  })
  await page.goto('/decks/d1')
  const list = page.getByRole('list', { name: 'Cards' })
  await page.getByRole('button', { name: /Difficult/ }).click()
  await expect(list.getByText('easy word')).toHaveCount(0)
  await expect(list.getByText('hard word')).toBeVisible()

  await page.getByRole('link', { name: 'Study deck' }).click()
  await expect(page).toHaveURL('/study?deck=d1')
  await page.goBack()
  await page.getByRole('link', { name: 'Practice difficult' }).click()
  await expect(page).toHaveURL('/study?deck=d1&practice=1')
  await page.goBack()

  await page
    .getByRole('list', { name: 'Cards' })
    .getByRole('link', { name: /hard word/ })
    .click()
  await expect(page).toHaveURL('/cards/hard')
  await expect(page.getByRole('heading', { level: 1, name: 'hard word' })).toBeVisible()
  const forward = page.getByRole('article', { name: 'Word → translation' })
  await expect(forward.getByText('Review', { exact: true })).toBeVisible()
  await expect(forward.getByText('Lapses')).toBeVisible()
  await expect(page.getByRole('article', { name: 'Translation → word' }).getByText('Not studied yet')).toBeVisible()
})
