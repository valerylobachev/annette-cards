import { expect, type Page, test } from '@playwright/test'
import { cardRow, deckRow, newStateRow, seed, useUiLanguage } from './helpers'

const WORDS = ['one', 'two', 'three', 'four', 'five']

test.beforeEach(async ({ page }) => {
  await useUiLanguage(page)
  await page.goto('/decks')
  await seed(page, {
    decks: [deckRow('d1', 'English B2', { directions: 'forward' })],
    cards: WORDS.map((word, i) => cardRow(`c${i}`, 'd1', word, `${word}-ru`, { created_at: i + 1 })),
    card_states: WORDS.map((_, i) => newStateRow(`c${i}`)),
  })
})

const progress = (page: Page) => page.getByTestId('study-progress')
const card = (page: Page) => page.getByTestId('swipe-card')

/**
 * Drags the current card horizontally by `share` of its width, one step per frame (WebKit's drag handling needs
 * frames between moves, as a real finger gives); `slow` ends with a pause so the release has no fling velocity.
 */
async function drag(page: Page, share: number, slow = false) {
  const box = await card(page).boundingBox()
  if (!box) throw new Error('no card')
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  for (let step = 1; step <= 10; step++) {
    await page.mouse.move(x + (box.width * share * step) / 10, y)
    await page.waitForTimeout(20)
  }
  if (slow) await page.waitForTimeout(250)
  await page.mouse.up()
}

test('swipe, undo, spring back and finish with buttons', async ({ page }) => {
  await page.goto('/study?deck=d1')
  await expect(page.getByText('5 cards')).toBeVisible()
  await page.getByRole('button', { name: 'Start' }).click()
  await expect(progress(page)).toHaveText('0 / 5')
  await expect(card(page)).toContainText('one')

  // Know on a new card: it comes back later as a learning step, so the total grows by one.
  await drag(page, 0.6)
  await expect(progress(page)).toHaveText('1 / 6')
  await expect(card(page)).toContainText('two')

  await page.getByRole('button', { name: 'Undo last answer' }).click()
  await expect(progress(page)).toHaveText('0 / 5')
  await expect(card(page)).toContainText('one')
  await expect(page.getByRole('button', { name: 'Undo last answer' })).toBeDisabled()

  // Below the threshold the card springs back without an answer.
  await drag(page, 0.2, true)
  await expect(card(page)).toContainText('one')
  await expect(progress(page)).toHaveText('0 / 5')

  for (let answers = 0; answers < 20 && !page.url().includes('/study/summary'); answers++) {
    const before = await progress(page).textContent()
    await page.getByRole('button', { name: 'Know', exact: true }).click()
    await expect(async () => {
      expect(page.url().includes('/study/summary') || (await progress(page).textContent()) !== before).toBe(true)
    }).toPass()
  }
  await expect(page).toHaveURL(/\/study\/summary\?session=/)
})

test('reload mid-session resumes at the same card', async ({ page }) => {
  await page.goto('/study?deck=d1')
  await page.getByRole('button', { name: 'Start' }).click()
  await page.getByRole('button', { name: "Don't know" }).click()
  await expect(progress(page)).toHaveText('1 / 6')
  await page.getByRole('button', { name: 'Know', exact: true }).click()
  await expect(progress(page)).toHaveText('2 / 7')
  await expect(card(page)).toContainText('three')

  await page.reload()
  await expect(page.getByText('Continuing where you left off')).toBeVisible()
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(progress(page)).toHaveText('2 / 7')
  await expect(card(page)).toContainText('three')
  await expect(page.getByRole('button', { name: 'Undo last answer' })).toBeEnabled()
})
