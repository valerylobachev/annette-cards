import { expect, test } from '@playwright/test'
import { cardRow, deckRow, newStateRow, readRow, seed, setUpApp } from './helpers'

test('dark theme applies before the app mounts after a reload', async ({ page }) => {
  await setUpApp(page)
  // Record the theme when parsing ends: after the classic theme.js in <head>, before the app's module script runs.
  await page.addInitScript(() => {
    document.addEventListener('readystatechange', () => {
      if (document.readyState === 'interactive') {
        Object.assign(window, {
          __themeAtParse: document.documentElement.dataset.theme ?? null,
          __appMountedAtParse: document.getElementById('root')?.childElementCount ?? 0,
        })
      }
    })
  })
  await page.goto('/settings')
  await page.getByRole('group', { name: 'Theme' }).getByRole('button', { name: 'Dark' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')

  await page.reload()
  const before = await page.evaluate(() => {
    const w = window as unknown as { __themeAtParse: string | null; __appMountedAtParse: number }
    return { theme: w.__themeAtParse, mounted: w.__appMountedAtParse }
  })
  expect(before).toEqual({ theme: 'dark', mounted: 0 })
  await expect(page.getByRole('group', { name: 'Theme' }).getByRole('button', { name: 'Dark' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )

  await page.getByRole('group', { name: 'Theme' }).getByRole('button', { name: 'System' }).click()
  await expect(page.locator('html')).not.toHaveAttribute('data-theme')
})

test('study settings persist across a reload and Detailed shows four answer buttons', async ({ page }) => {
  await setUpApp(page)
  await page.goto('/settings')
  await page.getByLabel('New words per day').selectOption('25')
  await page.getByLabel('Day starts at').selectOption('5')
  await page.getByRole('switch', { name: 'Show IPA on the front' }).uncheck()
  await page.getByRole('button', { name: 'Detailed (4 buttons)' }).click()
  await page.getByRole('button', { name: 'Front and answer' }).click()
  await expect.poll(async () => (await readRow(page, 'settings', 'user'))?.autoplay).toBe('front_and_back')

  await page.reload()
  await expect(page.getByLabel('New words per day')).toHaveValue('25')
  await expect(page.getByLabel('Day starts at')).toHaveValue('5')
  await expect(page.getByRole('switch', { name: 'Show IPA on the front' })).not.toBeChecked()
  await expect(page.getByRole('button', { name: 'Detailed (4 buttons)' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: 'Front and answer' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByText(/^Version/)).toBeVisible()

  await seed(page, {
    decks: [deckRow('d1', 'English B2', { directions: 'forward' })],
    cards: [cardRow('c1', 'd1', 'cat', 'кошка')],
    card_states: [newStateRow('c1')],
  })
  await page.goto('/study?deck=d1')
  await page.getByRole('button', { name: 'Start' }).click()
  for (const name of ['Again', 'Hard', 'Good', 'Easy']) {
    await expect(page.getByRole('button', { name, exact: true })).toBeVisible()
  }
})

test('the install hint shows once in iPhone Safari', async ({ page, browserName }) => {
  test.skip(browserName !== 'webkit', 'the WebKit project emulates iPhone Safari')
  await setUpApp(page, 'en', { installed: false })
  await page.goto('/')
  const hint = page.getByRole('dialog', { name: 'Install Annette on your iPhone' })
  await expect(hint).toBeVisible()
  await hint.getByRole('button', { name: 'Got it' }).click()
  await expect(hint).toBeHidden()
  await page.reload()
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(hint).toBeHidden()
  await page.goto('/settings')
  await page.getByRole('button', { name: 'Install on iPhone' }).click()
  await expect(hint).toBeVisible()
})
