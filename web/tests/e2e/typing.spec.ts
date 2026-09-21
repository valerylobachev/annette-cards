import { expect, test } from '@playwright/test'
import { cardRow, deckRow, newStateRow, seed, setUpApp } from './helpers'

const WORDS: [string, string][] = [
  ['kot', 'кот'],
  ['żółw', 'черепаха'],
  ['pies', 'собака'],
]

test.beforeEach(async ({ page }) => {
  await setUpApp(page)
  await seed(page, {
    decks: [deckRow('d1', 'Polish', { target_lang: 'pl-PL', directions: 'reverse' })],
    cards: WORDS.map(([front, back], i) => cardRow(`c${i}`, 'd1', front, back, { created_at: i + 1 })),
    card_states: WORDS.map((_, i) => newStateRow(`c${i}`, 'reverse')),
  })
})

test('typing: exact answer moves on, near miss waits for Continue, undo restores the card', async ({ page }) => {
  await page.goto('/study?deck=d1&mode=typing')
  await page.getByRole('button', { name: 'Start' }).click()
  const answer = page.getByRole('textbox', { name: 'Your answer' })
  const progress = page.getByTestId('study-progress')
  await expect(page.getByText('кот', { exact: true })).toBeVisible()
  await expect(answer).toBeFocused()

  // Exact: green, then the next card by itself; the keyboard (focus) stays in the field.
  await answer.fill('kot')
  await answer.press('Enter')
  await expect(page.getByText('Correct!')).toBeVisible()
  await expect(page.getByText('черепаха', { exact: true })).toBeVisible()
  await expect(answer).toHaveValue('')
  await expect(answer).toBeFocused()
  await expect(progress).toHaveText('1 / 4')

  // Near miss: typed without diacritics, the correction waits for Continue.
  await answer.fill('zolw')
  await answer.press('Enter')
  await expect(page.getByText('Almost')).toBeVisible()
  await expect(page.getByTestId('typing-diff')).toHaveText('żółw')
  await expect(progress).toHaveText('1 / 4')
  await answer.press('Enter')
  await expect(page.getByText('собака', { exact: true })).toBeVisible()
  await expect(progress).toHaveText('2 / 5')

  await page.getByRole('button', { name: 'Undo last answer' }).click()
  await expect(page.getByText('черепаха', { exact: true })).toBeVisible()
  await expect(progress).toHaveText('1 / 4')
  await expect(answer).toHaveValue('')
})
