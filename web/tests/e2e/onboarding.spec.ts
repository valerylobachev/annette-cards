import { expect, type Page, test } from '@playwright/test'
import { setUpApp } from './helpers'

/** Walks the onboarding up to the first-deck step with Polish as the studied language. */
async function toDeckStep(page: Page, labels: { start: string; next: string; polish: RegExp }) {
  await page.getByRole('button', { name: labels.start }).click()
  const next = page.getByRole('button', { name: labels.next })
  await expect(next).toBeDisabled()
  await page.getByRole('radio', { name: labels.polish }).check()
  await next.click()
  await page.getByRole('button', { name: '10', exact: true }).click()
  await next.click()
}

test('a new user is onboarded in English and adds the first word', async ({ page }) => {
  await setUpApp(page, 'en', { onboarded: false })
  await page.goto('/')
  await expect(page).toHaveURL('/welcome')
  await expect(page.getByRole('heading', { name: 'Annette Cards' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'I have an account' })).toHaveCount(0)

  await toDeckStep(page, { start: 'Get started', next: 'Next', polish: /Polish/ })
  await expect(page.getByLabel('Name')).toHaveValue('Polish')
  await page.getByRole('button', { name: /Add words manually/ }).click()

  await expect(page).toHaveURL(/\/cards\/new\?deck=/)
  await page.getByLabel('Word or phrase *').fill('dzień dobry')
  await page.getByLabel('Translation *').fill('добрый день')
  await page.getByRole('button', { name: 'Save', exact: true }).click()

  await expect(page).toHaveURL('/')
  await expect(page.getByRole('link', { name: /Polish.*PL.*1 due/ })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Hi there!' })).toBeVisible()
})

test('onboarding in Russian with an empty deck', async ({ page }) => {
  await setUpApp(page, 'en', { onboarded: false })
  await page.goto('/welcome')
  await page.getByRole('button', { name: 'Русский' }).click()
  await toDeckStep(page, { start: 'Начать', next: 'Далее', polish: /[Пп]ольский/ })
  await expect(page.getByLabel('Название')).toHaveValue('Польский')
  await page.getByRole('button', { name: /Начать с пустой колоды/ }).click()

  await expect(page).toHaveURL('/')
  await page.getByRole('navigation').getByRole('link', { name: 'Колоды' }).click()
  await expect(page.getByRole('list', { name: 'Колоды' }).getByText('Польский')).toBeVisible()
})

test('"Import a file" opens the import wizard with the new deck selected', async ({ page }) => {
  await setUpApp(page, 'en', { onboarded: false })
  await page.goto('/')
  await toDeckStep(page, { start: 'Get started', next: 'Next', polish: /Polish/ })
  await page.getByRole('button', { name: /Import a file/ }).click()
  await expect(page).toHaveURL(/\/import\?deck=/)
  await expect(page.getByLabel('Import into deck').locator('option:checked')).toHaveText('Polish')
})

test('iPhone Safari: the last step shows the install hint, then Today', async ({ page, browserName }) => {
  test.skip(browserName !== 'webkit', 'the install step exists only in iOS Safari')
  await setUpApp(page, 'en', { installed: false, onboarded: false })
  await page.goto('/')
  await toDeckStep(page, { start: 'Get started', next: 'Next', polish: /Polish/ })
  await page.getByRole('button', { name: /Start with an empty deck/ }).click()
  await expect(page.getByRole('heading', { name: 'Install Annette on your iPhone' })).toBeVisible()
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByRole('heading', { name: 'Hi there!' })).toBeVisible()
  // The install hint was just shown, so the one-time sheet does not open again.
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test.describe('with a Russian device language', () => {
  test.use({ locale: 'ru-RU' })

  test('onboarding starts in Russian', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveURL('/welcome')
    await expect(page.getByRole('button', { name: 'Начать' })).toBeVisible()
  })
})
