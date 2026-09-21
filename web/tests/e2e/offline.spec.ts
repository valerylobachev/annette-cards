import { type ChildProcess, spawn } from 'node:child_process'
import { expect, type Page, test } from '@playwright/test'
import { setUpApp } from './helpers'

// The service worker exists only in the production build, which the `previewURL` web server in
// playwright.config.ts builds. Each worker serves that build on its own port and stops the server to go offline:
// Playwright's `setOffline` in WebKit also fails requests the service worker answers from its cache, so it cannot
// show whether the precache works. A stopped server is what airplane mode looks like to the app.
const port = (workerIndex: number) => 4180 + workerIndex
let server: ChildProcess | null = null
let baseURL = ''

// Playwright requires an object pattern for the fixtures argument, even when none is used.
// biome-ignore lint/correctness/noEmptyPattern: see above
test.use({ baseURL: async ({}, use, testInfo) => use(`http://localhost:${port(testInfo.workerIndex)}`) })

// biome-ignore lint/correctness/noEmptyPattern: Playwright requires an object pattern
test.beforeAll(async ({}, testInfo) => {
  baseURL = `http://localhost:${port(testInfo.workerIndex)}`
  const args = ['exec', 'vite', 'preview', '--port', String(port(testInfo.workerIndex)), '--strictPort']
  server = spawn('pnpm', args, { stdio: 'ignore' })
  await expect
    .poll(
      () =>
        fetch(baseURL).then(
          (response) => response.ok,
          () => false,
        ),
      { timeout: 20_000 },
    )
    .toBe(true)
})

test.afterAll(() => {
  server?.kill()
})

async function goOffline() {
  const stopped = new Promise((resolve) => server?.once('exit', resolve))
  server?.kill()
  await stopped
  await expect
    .poll(() =>
      fetch(baseURL).then(
        () => 'up',
        () => 'down',
      ),
    )
    .toBe('down')
}

/** Waits until the service worker has precached the app shell and controls the page. */
async function waitForServiceWorker(page: Page) {
  await page.evaluate(() => navigator.serviceWorker.ready)
  if (!(await page.evaluate(() => navigator.serviceWorker.controller !== null))) await page.reload()
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true)
}

test('works offline: reload, create a deck, add a card, study it, reload', async ({ page }) => {
  await setUpApp(page)
  await waitForServiceWorker(page)
  await goOffline()

  await page.reload()
  await expect(page.getByRole('heading', { level: 1, name: 'Decks' })).toBeVisible()

  await page.getByRole('button', { name: 'Create deck' }).click()
  const sheet = page.getByRole('dialog', { name: 'New deck' })
  await sheet.getByLabel('Name').fill('Offline')
  await sheet.getByRole('radio', { name: 'Forward' }).click()
  await sheet.getByRole('button', { name: 'Create' }).click()
  await expect(page.getByRole('list', { name: 'Decks' }).getByText('Offline')).toBeVisible()

  // A navigation (not a client-side route change) while offline is answered by the service worker.
  await page.goto('/cards/new')
  await page.getByLabel('Word or phrase *').fill('offline')
  await page.getByLabel('Translation *').fill('без сети')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page).not.toHaveURL(/\/cards\/new/)

  await page.goto('/')
  await page.getByRole('button', { name: 'Start' }).click()
  await page.getByRole('button', { name: 'Start' }).click()
  await expect(page.getByTestId('swipe-card')).toContainText('offline')
  await page.getByRole('button', { name: 'Know', exact: true }).click()
  await expect(page.getByTestId('study-progress')).toHaveText('1 / 2')

  // A hard reload while offline comes from the precache and keeps the answer.
  await page.reload()
  await expect(page.getByText('Continuing where you left off')).toBeVisible()
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByTestId('study-progress')).toHaveText('1 / 2')
})
