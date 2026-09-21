import { expect, type Page, test } from '@playwright/test'
import { deckRow, seed, setUpApp } from './helpers'

const ME = { id: 'user-1', email: 'anna@example.com', display_name: 'Anna', is_admin: false, created_at: 1 }
const EMPTY_IDS = { decks: [], cards: [], card_states: [], review_log: [], settings: false }
const SUGGESTION = {
  back: 'черепаха',
  example: 'Żółw jest powolny.',
  example_translation: 'Черепаха медленная.',
  ipa: '/ʐuf/',
  notes: 'сущ., м. р.',
}

// Server requests only: an `/api/` glob would also catch Vite's modules under `/src/api/`.
const isApi = (url: URL) => url.pathname.startsWith('/api/')

/** A signed-in account with enrichment, answered by fixed responses: no test reaches a real model. */
async function mockSignedInServer(page: Page) {
  const enrichRequests: unknown[] = []
  await page.route(isApi, (route) => {
    const path = new URL(route.request().url()).pathname
    const json = (body: unknown) => route.fulfill({ status: 200, json: body })
    if (path === '/api/enrich') {
      enrichRequests.push(route.request().postDataJSON())
      return json(SUGGESTION)
    }
    if (path === '/api/meta') {
      return json({ version: '0.1.0', features: { tts: false, commons: false, enrich: true, push: false } })
    }
    if (path === '/api/auth/me') return json(ME)
    if (path === '/api/sync/push') {
      return json({ applied: EMPTY_IDS, skipped: EMPTY_IDS, rejected: [], server_time: Date.now() })
    }
    if (path === '/api/sync/pull') return json({ changes: {}, cursor: 0, has_more: false })
    return route.fulfill({ status: 404, json: { code: 'not_found', details: null } })
  })
  return enrichRequests
}

test.beforeEach(async ({ page }) => {
  await setUpApp(page)
  await seed(page, {
    decks: [deckRow('d1', 'Polish', { target_lang: 'pl-PL' })],
    meta: [
      { key: 'account', value: { user_id: ME.id, email: ME.email, display_name: ME.display_name, is_admin: false } },
      // A device that has seen the server before knows its features before `/api/meta` answers again.
      { key: 'server_features', value: { tts: false, commons: false, enrich: true, push: false } },
    ],
  })
})

test('quick add with AI: Enter, then one tap on Save', async ({ page }) => {
  const enrichRequests = await mockSignedInServer(page)
  await page.reload()
  await page.getByRole('button', { name: 'Add word' }).click()
  const sheet = page.getByRole('dialog', { name: 'Quick add' })
  await expect(sheet.getByLabel('Word or phrase')).toBeFocused()

  await page.keyboard.type('żółw')
  await page.keyboard.press('Enter')
  const suggestion = sheet.getByRole('region', { name: 'AI suggestions' })
  await expect(suggestion).toContainText('черепаха')
  await expect(suggestion).toContainText('Żółw jest powolny.')
  await sheet.getByRole('button', { name: 'Save' }).click()

  await expect(page.getByRole('status').getByText('Added')).toBeVisible()
  await expect(sheet.getByLabel('Word or phrase')).toBeFocused()
  expect(enrichRequests).toEqual([{ front: 'żółw', target_lang: 'pl-PL', native_lang: 'ru' }])

  await page.keyboard.press('Escape')
  await page.goto('/decks/d1')
  await expect(page.getByText('żółw')).toBeVisible()
  await expect(page.getByText('черепаха')).toBeVisible()
})

test('quick add offline shows the translation field without calling the API', async ({ page }) => {
  const enrichRequests = await mockSignedInServer(page)
  await page.reload()
  await expect(page.getByRole('list', { name: 'Decks' }).getByText('Polish')).toBeVisible()
  // Airplane mode as the app sees it (see audio.spec.ts).
  await page.route(isApi, (route) => route.abort('internetdisconnected'))
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'onLine', { get: () => false, configurable: true })
    window.dispatchEvent(new Event('offline'))
  })

  await page.getByRole('button', { name: 'Add word' }).click()
  const sheet = page.getByRole('dialog', { name: 'Quick add' })
  await expect(sheet.getByLabel('Word or phrase')).toBeFocused()
  await page.keyboard.type('kot')
  await page.keyboard.press('Enter')
  await expect(sheet.getByLabel('Translation')).toBeFocused()
  await page.keyboard.type('кот')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('status').getByText('Added')).toBeVisible()
  expect(enrichRequests).toEqual([])
})

test('Fill with AI in the editor is disabled offline', async ({ page }) => {
  await mockSignedInServer(page)
  await page.goto('/cards/new?deck=d1')
  const fill = page.getByRole('button', { name: 'Fill with AI' })
  await page.getByLabel('Word or phrase *').fill('kot')
  await expect(fill).toBeEnabled()

  await page.evaluate(() => {
    Object.defineProperty(navigator, 'onLine', { get: () => false, configurable: true })
    window.dispatchEvent(new Event('offline'))
  })
  await expect(fill).toBeDisabled()
  await expect(page.getByText('Available online')).toBeVisible()
})
