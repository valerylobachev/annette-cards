import { expect, type Page, test } from '@playwright/test'
import { cardRow, deckRow, newStateRow, seed, useUiLanguage } from './helpers'

const WORDS = ['one', 'two', 'three', 'four', 'five']

test.beforeEach(async ({ page }) => {
  await useUiLanguage(page)
  await page.goto('/decks')
  await seed(page, {
    decks: [deckRow('d1', 'English B2', { directions: 'forward', new_per_day: 3 })],
    cards: WORDS.map((word, i) => cardRow(`c${i}`, 'd1', word, `${word}-ru`, { created_at: i + 1 })),
    card_states: WORDS.map((_, i) => newStateRow(`c${i}`)),
  })
})

async function answerUntilSummary(page: Page) {
  for (let answers = 0; answers < 20 && !page.url().includes('/study/summary'); answers++) {
    const before = await page.getByTestId('study-progress').textContent()
    await page.getByRole('button', { name: 'Know', exact: true }).click()
    await expect(async () => {
      const progress = page.url().includes('/study/summary')
        ? null
        : await page.getByTestId('study-progress').textContent()
      expect(progress).not.toBe(before)
    }).toPass()
  }
  await expect(page).toHaveURL(/\/study\/summary/)
}

test('Today → study → summary → repeat → Done', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('New: 3')).toBeVisible()
  await expect(page.getByRole('link', { name: /English B2.*3 due/ })).toBeVisible()
  await page.getByRole('button', { name: 'Start' }).click()
  await page.getByRole('button', { name: 'Start' }).click()

  await page.getByRole('button', { name: "Don't know" }).click()
  await expect(page.getByTestId('study-progress')).toHaveText('1 / 4')
  await answerUntilSummary(page)

  await expect(page.getByText('Difficult in this session')).toBeVisible()
  await expect(page.getByRole('link', { name: 'one — one-ru' })).toBeVisible()
  await page.getByRole('link', { name: 'Repeat these now' }).click()
  await expect(page).toHaveURL(/\/study\?practice=1&repeat=/)
  await expect(page.getByText('Practice difficult words')).toBeVisible()
  await expect(page.getByText('1 card')).toBeVisible()

  await page.goBack()
  await page.getByRole('button', { name: 'Done' }).click()
  await expect(page).toHaveURL('/')
  await expect(page.getByText(/^Nothing due\./)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Learn extra new words' })).toBeVisible()
  await expect(page.getByText('1 day')).toBeVisible()
})

test('study card and controls have accessible names', async ({ page }) => {
  await page.goto('/study?deck=d1')
  await page.getByRole('button', { name: 'Start' }).click()
  await expect(page.getByRole('button', { name: 'Word: one. Double-tap to reveal the translation.' })).toBeVisible()
  for (const name of ["Don't know", 'Know', 'Undo last answer', 'Close session']) {
    await expect(page.getByRole('button', { name, exact: true })).toBeVisible()
  }
  await expect(page.getByRole('progressbar', { name: 'Session progress' })).toHaveAttribute('aria-valuetext', '0 / 3')

  await page.getByRole('button', { name: 'Know', exact: true }).click()
  await expect(page.getByTestId('study-progress')).toHaveText('1 / 4')
  await page.getByRole('button', { name: 'Undo last answer' }).click()
  await expect(page.getByText('Answer undone. one is back.')).toBeAttached()
})

test.describe('with reduced motion', () => {
  test.use({ reducedMotion: 'reduce' })

  test('the card cross-fades instead of turning', async ({ page }) => {
    await page.goto('/study?deck=d1')
    await page.getByRole('button', { name: 'Start' }).click()
    await page.getByRole('button', { name: /^Word: one\./ }).click()
    await expect(page.getByText('one-ru')).toBeVisible()
    await page.waitForTimeout(400)
    const transform = await page.getByTestId('card-sides').evaluate((node) => getComputedStyle(node).transform)
    expect(transform).toBe('none')
  })
})

test('without reduced motion the card turns', async ({ page }) => {
  await page.goto('/study?deck=d1')
  await page.getByRole('button', { name: 'Start' }).click()
  await page.getByRole('button', { name: /^Word: one\./ }).click()
  await page.waitForTimeout(400)
  const transform = await page.getByTestId('card-sides').evaluate((node) => getComputedStyle(node).transform)
  expect(transform).not.toBe('none')
})
