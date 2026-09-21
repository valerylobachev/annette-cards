import { expect, test } from '@playwright/test'
import { cardRow, deckRow, seed, setUpApp } from './helpers'

test.beforeEach(async ({ page }) => {
  await setUpApp(page)
  // Force the download path: headless browsers may offer a share sheet that a test cannot close.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true })
  })
})

test('export a backup, lose the data, restore it with Replace', async ({ page }, testInfo) => {
  await page.goto('/decks')
  await seed(page, {
    decks: [deckRow('d1', 'English B2'), deckRow('d2', 'Polish A1', { target_lang: 'pl-PL' })],
    cards: [
      cardRow('c1', 'd1', 'cat', 'кошка'),
      cardRow('c2', 'd1', 'dog', 'собака'),
      cardRow('c3', 'd2', 'kot', 'кот'),
    ],
  })

  await page.goto('/settings')
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export full backup' }).click()
  const file = await download
  expect(file.suggestedFilename()).toMatch(/^annette-backup-\d{4}-\d{2}-\d{2}\.json$/)
  const backupPath = testInfo.outputPath('backup.json')
  await file.saveAs(backupPath)

  // Lose the data: delete both decks through the app.
  await page.goto('/decks')
  for (const name of ['English B2', 'Polish A1']) {
    await page.getByRole('button', { name: `Actions for ${name}` }).click()
    await page.getByRole('menuitem', { name: 'Delete' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click()
  }
  await expect(page.getByText('No decks yet')).toBeVisible()

  await page.goto('/settings')
  await page.getByLabel('Import backup').setInputFiles(backupPath)
  const sheet = page.getByRole('dialog', { name: 'Restore backup' })
  await expect(sheet.getByText('2 decks, 3 cards, 0 reviews')).toBeVisible()
  await sheet.getByRole('button', { name: 'Replace local data' }).click()
  await page
    .getByRole('dialog', { name: 'Replace all local data?' })
    .getByRole('button', { name: 'Replace local data' })
    .click()

  await expect(page).toHaveURL(/\/decks$/)
  const list = page.getByRole('list', { name: 'Decks' })
  await expect(list.getByRole('link', { name: /^English B2 .*· 2 cards/ })).toBeVisible()
  await expect(list.getByRole('link', { name: /^Polish A1 .*· 1 card/ })).toBeVisible()
})

test('rejects a backup from a newer app version', async ({ page }, testInfo) => {
  const path = testInfo.outputPath('future.json')
  const { writeFile } = await import('node:fs/promises')
  await writeFile(path, JSON.stringify({ format: 'annette-cards-backup', version: 2, app_version: '3.0.0' }))
  await page.goto('/settings')
  await page.getByLabel('Import backup').setInputFiles(path)
  await expect(page.getByRole('alert').filter({ hasText: 'This backup needs' })).toHaveText(
    'This backup needs app version 3.0.0 or newer.',
  )
})

test('exports a deck as CSV from the deck menu', async ({ page }) => {
  await page.goto('/decks')
  await seed(page, { decks: [deckRow('d1', 'English B2')], cards: [cardRow('c1', 'd1', 'cat', 'кошка')] })
  await page.goto('/decks/d1')
  await page.getByRole('button', { name: 'Deck actions' }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('menuitem', { name: 'Export deck' }).click()
  expect((await download).suggestedFilename()).toMatch(/^English B2-\d{4}-\d{2}-\d{2}\.csv$/)
})
