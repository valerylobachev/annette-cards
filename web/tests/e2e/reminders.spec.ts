import { expect, type Page, test } from '@playwright/test'
import { seed, setUpApp } from './helpers'

// The service worker exists only in the production build (the preview web server in playwright.config.ts). A push
// is delivered through the Chrome DevTools Protocol, which WebKit does not have; the iPhone is checked by hand.
const previewURL = 'http://localhost:4173'
test.use({ baseURL: previewURL })

async function waitForServiceWorker(page: Page) {
  await page.evaluate(() => navigator.serviceWorker.ready)
  if (!(await page.evaluate(() => navigator.serviceWorker.controller !== null))) await page.reload()
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true)
}

type Shown = { title: string; body?: string; tag?: string }

test('a reminder push shows the localized notification', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'push events are delivered with the Chrome DevTools Protocol')
  await setUpApp(page, 'ru')
  await seed(page, { settings: [{ id: 'user', ui_language: 'ru', updated_at: 1, updated_by: 'e2e' }] })
  await waitForServiceWorker(page)

  // Headless Chromium has no notification center: the worker's showNotification calls are recorded instead.
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'))
  await worker.evaluate(() => {
    // The DOM library has no worker scope type; only these two members are used.
    const scope = self as unknown as { shown: Shown[]; registration: ServiceWorkerRegistration }
    scope.shown = []
    scope.registration.showNotification = async (title: string, options?: NotificationOptions) => {
      scope.shown.push({ title, body: options?.body, tag: options?.tag })
    }
  })
  const shown = () => worker.evaluate(() => (self as unknown as { shown: Shown[] }).shown)

  const cdp = await context.newCDPSession(page)
  const registered = new Promise<string>((resolve) => {
    cdp.on('ServiceWorker.workerRegistrationUpdated', ({ registrations }) => {
      const ours = registrations.find((registration) => registration.scopeURL === `${previewURL}/`)
      if (ours) resolve(ours.registrationId)
    })
  })
  await cdp.send('ServiceWorker.enable')
  const registrationId = await registered
  const push = (data: unknown) =>
    cdp.send('ServiceWorker.deliverPushMessage', { origin: previewURL, registrationId, data: JSON.stringify(data) })

  await push({ type: 'something-else' })
  await push({ type: 'reminder', due: 3 })
  await push({ type: 'reminder', due: 5 })
  await expect.poll(shown).toEqual([
    { title: 'Пора повторить', body: '3 слова на повторение', tag: 'reminder' },
    { title: 'Пора повторить', body: '5 слов на повторение', tag: 'reminder' },
  ])
})
