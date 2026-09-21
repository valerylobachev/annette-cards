import { expect, test } from '@playwright/test'
import { cardRow, deckRow, seed, useUiLanguage } from './helpers'

test('create, rename, delete and undo a deck', async ({ page }) => {
  await useUiLanguage(page)
  await page.goto('/decks')
  await expect(page.getByText('No decks yet')).toBeVisible()

  await page.getByRole('button', { name: 'Create deck' }).click()
  const sheet = page.getByRole('dialog', { name: 'New deck' })
  await sheet.getByLabel('Name').fill('English B2')
  await sheet.getByRole('button', { name: 'Create' }).click()
  const list = page.getByRole('list', { name: 'Decks' })
  await expect(list.getByText('English B2')).toBeVisible()

  await page.getByRole('button', { name: 'Actions for English B2' }).click()
  await page.getByRole('menuitem', { name: 'Rename' }).click()
  const rename = page.getByRole('dialog', { name: 'Rename deck' })
  await rename.getByLabel('Name').fill('English C1')
  await rename.getByRole('button', { name: 'Save' }).click()
  await expect(list.getByText('English C1')).toBeVisible()

  await page.getByRole('button', { name: 'Actions for English C1' }).click()
  await page.getByRole('menuitem', { name: 'Delete' }).click()
  const confirm = page.getByRole('dialog', { name: 'Delete deck and 0 cards?' })
  await confirm.getByRole('button', { name: 'Delete' }).click()
  await expect(list.getByText('English C1')).toHaveCount(0)

  await page.getByRole('status').getByRole('button', { name: 'Undo' }).click()
  await expect(list.getByText('English C1')).toBeVisible()
})

test('Russian UI uses plural forms', async ({ page }) => {
  await useUiLanguage(page, 'ru')
  await page.goto('/decks')
  await expect(page.getByText('Колод пока нет')).toBeVisible()
  await seed(page, {
    decks: [deckRow('d1', 'Одна'), deckRow('d2', 'Две'), deckRow('d5', 'Пять')],
    cards: [
      cardRow('c1', 'd1', 'a', 'а'),
      ...['a', 'b'].map((w) => cardRow(`d2-${w}`, 'd2', w, w)),
      ...['a', 'b', 'c', 'd', 'e'].map((w) => cardRow(`d5-${w}`, 'd5', w, w)),
    ],
  })
  await page.reload()

  const list = page.getByRole('list', { name: 'Колоды' })
  await expect(list.getByText('EN-GB → RU · 1 карточка')).toBeVisible()
  await expect(list.getByText('EN-GB → RU · 2 карточки')).toBeVisible()
  await expect(list.getByText('EN-GB → RU · 5 карточек')).toBeVisible()

  await page.getByRole('button', { name: 'Действия с колодой «Пять»' }).click()
  await page.getByRole('menuitem', { name: 'Удалить' }).click()
  await expect(page.getByRole('dialog', { name: 'Удалить колоду и 5 карточек?' })).toBeVisible()
})

test('swipe left reveals Archive; long-press opens the context menu', async ({ page }) => {
  await useUiLanguage(page)
  await page.goto('/decks')
  await seed(page, { decks: [deckRow('d1', 'Swipe me'), deckRow('d2', 'Hold me')] })
  await page.reload()

  const row = page.getByRole('link', { name: /Swipe me/ })
  const box = await row.boundingBox()
  if (!box) throw new Error('row not visible')
  const y = box.y + box.height / 2
  await page.mouse.move(box.x + box.width - 10, y)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width - 110, y, { steps: 8 })
  await page.mouse.move(box.x + box.width - 200, y, { steps: 8 })
  await page.mouse.up()
  await page.getByRole('button', { name: 'Archive', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Archived (1)' })).toBeVisible()

  const held = page.getByRole('link', { name: /Hold me/ })
  const heldBox = await held.boundingBox()
  if (!heldBox) throw new Error('row not visible')
  await page.mouse.move(heldBox.x + 20, heldBox.y + heldBox.height / 2)
  await page.mouse.down()
  await page.waitForTimeout(700)
  await page.mouse.up()
  await expect(page.getByRole('menu', { name: 'Actions for Hold me' })).toBeVisible()
  await expect(page).toHaveURL('/decks')
})
