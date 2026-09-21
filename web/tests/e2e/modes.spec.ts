import { expect, type Page, test } from '@playwright/test'
import { cardRow, deckRow, newStateRow, seed, setUpApp, stubSpeech } from './helpers'

const WORDS: Record<string, string> = { kot: 'кот', pies: 'собака', ryba: 'рыба', koń: 'конь' }

async function seedPolish(page: Page, words: Record<string, string>) {
  const entries = Object.entries(words)
  await seed(page, {
    decks: [deckRow('d1', 'Polish', { target_lang: 'pl-PL', directions: 'forward', new_per_day: 1 })],
    cards: entries.map(([front, back], i) => cardRow(`c${i}`, 'd1', front, back, { created_at: i + 1 })),
    card_states: entries.map((_, i) => newStateRow(`c${i}`)),
  })
}

test.beforeEach(async ({ page }) => {
  await stubSpeech(page)
  await setUpApp(page)
})

/** Answers correctly until the summary opens (a learning step brings a new card back once or twice). */
async function answerUntilSummary(page: Page, correctOption: () => Promise<string>) {
  const options = page.getByRole('list', { name: 'Answers' })
  for (let answers = 0; answers < 10 && !page.url().includes('/study/summary'); answers++) {
    const before = await page.getByTestId('study-progress').textContent()
    await options.getByRole('button', { name: await correctOption(), exact: true }).click()
    await expect(async () => {
      const progress = await page
        .getByTestId('study-progress')
        .textContent({ timeout: 100 })
        .catch(() => null)
      expect(page.url().includes('/study/summary') || progress !== before).toBe(true)
    }).toPass()
  }
  await expect(page).toHaveURL(/\/study\/summary\?session=/)
}

test('the mode chosen on Today persists, and a Choice session runs offline', async ({ page, context }) => {
  await seedPolish(page, WORDS)
  await page.goto('/')
  await expect(page.getByText('New: 1')).toBeVisible()
  await page.getByRole('button', { name: 'Choice' }).click()
  // Pressed once the choice is stored, so the reload reads it back.
  await expect(page.getByRole('button', { name: 'Choice' })).toHaveAttribute('aria-pressed', 'true')
  await page.reload()
  await expect(page.getByRole('button', { name: 'Choice' })).toHaveAttribute('aria-pressed', 'true')

  await context.setOffline(true)
  await page.getByRole('button', { name: 'Start' }).click()
  await expect(page).toHaveURL(/mode=choice/)
  await page.getByRole('button', { name: 'Start' }).click()
  await expect(page.getByRole('list', { name: 'Answers' }).getByRole('button')).toHaveCount(4)
  await answerUntilSummary(page, async () => WORDS.kot ?? '')

  await page.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByText('New: 1')).toBeHidden()
  await expect(page.getByText('1 day')).toBeVisible()
})

test('a Listening session plays the word and completes offline', async ({ page, context }) => {
  await seedPolish(page, WORDS)
  await page.goto('/')
  await page.getByRole('button', { name: 'Listening' }).click()
  await context.setOffline(true)
  await page.getByRole('button', { name: 'Start' }).click()
  await page.getByRole('button', { name: 'Start' }).click()
  await expect(page.getByRole('button', { name: 'Play slower' })).toBeVisible()

  const lastSpoken = () =>
    page.evaluate(() => {
      const spoken = (window as unknown as { __spoken: { text: string }[] }).__spoken
      return spoken.at(-1)?.text ?? ''
    })
  await expect.poll(lastSpoken).toBe('kot')
  await answerUntilSummary(page, lastSpoken)
  await page.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByText('1 day')).toBeVisible()
})

test('Choice and Listening are unavailable with fewer than 4 words', async ({ page }) => {
  await seedPolish(page, { kot: 'кот', pies: 'собака' })
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Choice' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Listening' })).toBeDisabled()
  await expect(page.getByText('Choice and listening need at least 4 different words in one language.')).toBeVisible()
})
