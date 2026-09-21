import path from 'node:path'
import { expect, test } from '@playwright/test'
import { deckRow, seed, setUpApp } from './helpers'

const fixture = (name: string) => path.join(import.meta.dirname, 'fixtures', name)

test.beforeEach(async ({ page }) => {
  await setUpApp(page)
})

test('imports a 300-word CSV into a new deck', async ({ page }) => {
  await page.goto('/import')

  await page.getByRole('button', { name: 'New deck' }).click()
  const sheet = page.getByRole('dialog', { name: 'New deck' })
  await sheet.getByLabel('Name').fill('Imported words')
  await sheet.getByRole('button', { name: 'Create' }).click()
  await expect(page.getByLabel('Import into deck').locator('option:checked')).toHaveText('Imported words')

  await page.getByLabel('File', { exact: true }).setInputFiles(fixture('words-300.csv'))
  await page.getByRole('button', { name: 'Next' }).click()

  await expect(page.getByText('Delimiter: comma · Encoding: UTF-8')).toBeVisible()
  await expect(page.getByLabel('First row is a header')).toBeChecked()
  await expect(page.getByLabel('Column 1')).toHaveValue('front')
  await expect(page.getByLabel('Column 2')).toHaveValue('back')
  await expect(page.getByLabel('Column 3')).toHaveValue('example')
  await expect(page.getByLabel('Column 4')).toHaveValue('tags')
  await expect(page.getByRole('cell', { name: 'word 010' })).toBeVisible()
  await page.getByRole('button', { name: 'Next' }).click()

  await expect(page.getByRole('button', { name: 'Import 300 cards' })).toBeEnabled()
  await page.getByRole('button', { name: 'Import 300 cards' }).click()

  await expect(page.getByText('Imported 300 cards into «Imported words»')).toBeVisible()
  await page.getByRole('button', { name: 'Open deck' }).click()
  await expect(page.getByRole('heading', { name: 'Imported words' })).toBeVisible()
  await expect(page.getByRole('button', { name: /^300\s*New$/ })).toBeVisible()
})

test('rejects a file that is not UTF-8', async ({ page }) => {
  await page.goto('/decks')
  await seed(page, { decks: [deckRow('target', 'Target')] })
  await page.goto('/import?deck=target')

  await page.getByLabel('File', { exact: true }).setInputFiles(fixture('words-cp1251.csv'))
  await page.getByRole('button', { name: 'Next' }).click()

  await expect(page.getByRole('alert')).toHaveText(/Save the file as UTF-8 and try again/)
})

test('blocks the import when every row is invalid and offers the error report', async ({ page }) => {
  await page.goto('/decks')
  await seed(page, { decks: [deckRow('target', 'Target')] })
  await page.goto('/import?deck=target')

  await page.getByLabel('Or paste text').fill('word,translation\ncat,\n,собака\n')
  await page.getByRole('button', { name: 'Next' }).click()
  await page.getByRole('button', { name: 'Next' }).click()

  await expect(page.getByText('Row 1: no translation')).toBeVisible()
  await expect(page.getByText('Row 2: no word')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Import 0 cards' })).toBeDisabled()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download error report' }).click()
  expect((await download).suggestedFilename()).toBe('import-errors.csv')
})
