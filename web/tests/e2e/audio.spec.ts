import { readFileSync } from 'node:fs'
import { expect, type Page, test } from '@playwright/test'
import { cardRow, deckRow, newStateRow, seed, setUpApp, spoken, stubSpeech } from './helpers'

// A public-domain pronunciation from Wikimedia Commons (File:En-us-read.ogg by Dvortygirl), in the MP3 transcode
// the server stores.
const clip = readFileSync(new URL('./fixtures/read-en-us.mp3', import.meta.url))
const ATTRIBUTION = 'Dvortygirl · Public domain · https://commons.wikimedia.org/wiki/File:En-us-read.ogg'

/** Records every `<audio>` play that the browser accepted, then lets it play for real. */
async function recordPlays(page: Page) {
  await page.addInitScript(() => {
    const played: string[] = []
    Object.assign(window, { __played: played })
    const play = HTMLMediaElement.prototype.play
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      const started = play.call(this)
      // The silent unlock clip is a WAV; count only the pronunciation clips.
      started.then(
        () => this.src.startsWith('blob:') && this.duration > 0.5 && played.push(this.src),
        () => {},
      )
      return started
    }
  })
}

/**
 * Airplane mode as the app sees it: `navigator.onLine` is false and requests fail. (Playwright's `setOffline` in
 * WebKit would also refuse to load the clip from its blob URL, which a real offline iPhone does not.)
 */
async function goOffline(page: Page) {
  await page.route('**/api/**', (route) => route.abort('internetdisconnected'))
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'onLine', { get: () => false, configurable: true })
    window.dispatchEvent(new Event('offline'))
  })
}

const plays = (page: Page) => page.evaluate(() => (window as unknown as { __played: string[] }).__played.length)

test.beforeEach(async ({ page }) => {
  await setUpApp(page)
  await stubSpeech(page)
  await recordPlays(page)
  await page.goto('/decks')
  await seed(page, {
    decks: [deckRow('d1', 'English', { directions: 'forward' })],
    cards: [
      cardRow('c1', 'd1', 'read', 'читать', { audio_id: 'clip-1' }),
      cardRow('c2', 'd1', 'lead', 'вести', { audio_id: 'clip-2' }),
    ],
    card_states: [newStateRow('c1'), newStateRow('c2')],
  })
})

test('a clip plays online, then from the cache offline; an uncached one falls back to speech', async ({ page }) => {
  let downloads = 0
  await page.route('**/api/audio/clip-1', (route) => {
    downloads += 1
    return route.fulfill({
      status: 200,
      body: clip,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'private, max-age=31536000, immutable',
        'X-Audio-Source': 'commons',
        'X-Audio-Attribution': encodeURIComponent(ATTRIBUTION),
      },
    })
  })
  await page.goto('/decks/d1')

  await page.getByRole('button', { name: 'Pronounce “read”' }).click()
  await expect.poll(() => plays(page)).toBe(1)
  expect(downloads).toBe(1)

  await goOffline(page)
  await page.getByRole('button', { name: 'Pronounce “read”' }).click()
  await expect.poll(() => plays(page)).toBe(2)
  expect(downloads).toBe(1)

  // Offline and never downloaded: the system voice speaks the word in the deck's language.
  await page.getByRole('button', { name: 'Pronounce “lead”' }).click()
  await expect.poll(() => spoken(page)).toEqual([expect.objectContaining({ text: 'lead', lang: 'en-GB' })])
  expect(await plays(page)).toBe(2)
  expect((await spoken(page)).map((entry) => entry.text)).not.toContain('read')
})

test('the card view names the source and the attribution of a cached recording', async ({ page }) => {
  await page.route('**/api/audio/clip-1', (route) =>
    route.fulfill({
      status: 200,
      body: clip,
      headers: {
        'Content-Type': 'audio/mpeg',
        'X-Audio-Source': 'commons',
        'X-Audio-Attribution': encodeURIComponent(ATTRIBUTION),
      },
    }),
  )
  await page.goto('/cards/c1')
  const section = page.getByRole('region', { name: 'Pronunciation' })
  await expect(section.getByTestId('audio-source')).toHaveText('Recording')
  await expect(section.getByText(ATTRIBUTION)).toBeVisible()
  // Signed out: no server actions.
  await expect(section.getByRole('button')).toHaveCount(0)

  // In-app navigation: Playwright's WebKit keeps Cache Storage only within one document (a reload empties it).
  await page.getByRole('link', { name: 'Settings' }).click()
  await expect(page.getByTestId('cached-audio')).toHaveText('1 audio clip saved')
  await page.getByText('Recordings (Wikimedia Commons)').click()
  await expect(page.getByText(ATTRIBUTION)).toBeVisible()
})
