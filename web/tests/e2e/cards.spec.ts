import { expect, test } from '@playwright/test'
import { cardRow, deckRow, seed, setUpApp } from './helpers'

test.beforeEach(async ({ page }) => {
  await setUpApp(page)
  await page.goto('/decks')
  await seed(page, {
    decks: [deckRow('d1', 'English'), deckRow('d2', 'Polish', { target_lang: 'pl-PL' })],
    cards: [cardRow('c1', 'd1', 'take off', 'взлетать')],
  })
  await page.reload()
  await expect(page.getByRole('list', { name: 'Decks' }).getByText('English')).toBeVisible()
})

test('quick add two words in a row with the keyboard only', async ({ page }) => {
  await page.getByRole('button', { name: 'Add word' }).click()
  const sheet = page.getByRole('dialog', { name: 'Quick add' })
  await expect(sheet.getByLabel('Deck')).toHaveValue('d1')
  const word = sheet.getByLabel('Word or phrase')
  await expect(word).toBeFocused()

  const words: [string, string][] = [
    ['apple', 'яблоко'],
    ['pear', 'груша'],
  ]
  for (const [front, back] of words) {
    await page.keyboard.type(front)
    await page.keyboard.press('Enter')
    await expect(sheet.getByLabel('Translation')).toBeFocused()
    await page.keyboard.type(back)
    await page.keyboard.press('Enter')
    await expect(page.getByRole('status').getByText('Added')).toBeVisible()
    await expect(word).toBeFocused()
    await expect(word).toHaveValue('')
  }

  await page.keyboard.press('Escape')
  await expect(page.getByText('EN-GB → RU · 3 cards')).toBeVisible()
})

test('quick add warns about a duplicate and can open the existing card', async ({ page }) => {
  await page.getByRole('button', { name: 'Add word' }).click()
  const sheet = page.getByRole('dialog', { name: 'Quick add' })
  await sheet.getByLabel('Word or phrase').fill('  Take OFF ')
  await expect(sheet.getByText('Already in deck: take off — взлетать')).toBeVisible()
  await expect(sheet.getByRole('button', { name: 'Add anyway' })).toBeVisible()
  await sheet.getByRole('button', { name: 'Open existing' }).click()
  await expect(page).toHaveURL('/cards/c1')
})

test('the deck of the last quick add is remembered', async ({ page }) => {
  await page.getByRole('button', { name: 'Add word' }).click()
  const sheet = page.getByRole('dialog', { name: 'Quick add' })
  await sheet.getByLabel('Deck').selectOption('d2')
  await page.keyboard.press('Escape')
  await page.reload()
  await page.getByRole('button', { name: 'Add word' }).click()
  await expect(page.getByRole('dialog', { name: 'Quick add' }).getByLabel('Deck')).toHaveValue('d2')
})

test('editor: Save and add another keeps the deck and the tags', async ({ page }) => {
  await page.goto('/cards/new?deck=d2')
  await expect(page.getByRole('navigation')).toHaveCount(0)
  await expect(page.getByLabel('Deck')).toHaveValue('d2')

  await page.getByLabel('Word or phrase *').fill('dzień dobry')
  await page.getByLabel('Translation *').fill('добрый день')
  const tags = page.getByLabel('Tags')
  await tags.fill('greetings')
  await tags.press('Enter')
  await page.getByRole('button', { name: 'Save and add another' }).click()

  await expect(page.getByLabel('Word or phrase *')).toHaveValue('')
  await expect(page.getByLabel('Word or phrase *')).toBeFocused()
  await expect(page.getByLabel('Deck')).toHaveValue('d2')
  await expect(page.getByRole('button', { name: 'Remove tag greetings' })).toBeVisible()

  // Required fields are validated.
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText('Required')).toHaveCount(2)
})

test('editor shows the duplicate warning and the IPA helper row', async ({ page }) => {
  await page.goto('/cards/new?deck=d1')
  await page.getByLabel('Word or phrase *').fill('Take off')
  await expect(page.getByText('Already in deck:')).toBeVisible()
  await expect(page.getByRole('link', { name: 'take off — взлетать' })).toHaveAttribute('href', '/cards/c1')

  const ipa = page.getByLabel('IPA (transcription)')
  await ipa.fill('teɪk')
  await ipa.evaluate((input: HTMLInputElement) => input.setSelectionRange(0, 0))
  await page.getByRole('toolbar', { name: 'IPA symbols' }).getByRole('button', { name: 'Insert ˈ' }).click()
  await expect(ipa).toHaveValue('ˈteɪk')
  await expect(ipa).toBeFocused()
})
