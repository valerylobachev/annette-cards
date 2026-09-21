import { expect, test } from '@playwright/test'
import { useUiLanguage } from './helpers'

test.beforeEach(async ({ page }) => {
  await useUiLanguage(page)
})

test('app loads and the four tabs navigate', async ({ page }) => {
  await page.goto('/')
  const nav = page.getByRole('navigation', { name: 'Main navigation' })
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible()

  for (const [tab, path] of [
    ['Decks', '/decks'],
    ['Statistics', '/stats'],
    ['Settings', '/settings'],
    ['Today', '/'],
  ] as const) {
    await nav.getByRole('link', { name: tab }).click()
    await expect(page).toHaveURL(path)
    await expect(page.getByRole('heading', { level: 1, name: tab })).toBeVisible()
  }

  await page.goBack()
  await expect(page).toHaveURL('/settings')
})

test('study route hides the tab bar', async ({ page }) => {
  await page.goto('/study?deck=d1&mode=swipe')
  await expect(page.getByRole('heading', { name: 'Study' })).toBeVisible()
  await expect(page.getByRole('navigation')).toHaveCount(0)
})

test('switching language to Russian shows Russian tab labels', async ({ page }) => {
  await page.goto('/settings')
  await page.getByRole('button', { name: 'Русский' }).click()

  const nav = page.getByRole('navigation', { name: 'Основная навигация' })
  await expect(nav.getByRole('link')).toHaveText(['Сегодня', 'Колоды', 'Статистика', 'Настройки'])

  await page.reload()
  await expect(page.getByRole('heading', { name: 'Настройки' })).toBeVisible()
})
