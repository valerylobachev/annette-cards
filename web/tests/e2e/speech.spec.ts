import { expect, type Page, test } from '@playwright/test'
import { cardRow, deckRow, newStateRow, seed, setUpApp } from './helpers'

type Spoken = { text: string; lang: string; voice: string | null; rate: number }

/** Replaces the Web Speech API with a recorder: three English voices, every `speak` call kept in `__spoken`. */
async function stubSpeech(page: Page) {
  await page.addInitScript(() => {
    const voices = [
      {
        name: 'Daniel',
        lang: 'en-GB',
        voiceURI: 'com.apple.voice.compact.en-GB.Daniel',
        default: true,
        localService: true,
      },
      {
        name: 'Malcolm (Premium)',
        lang: 'en-GB',
        voiceURI: 'com.apple.voice.premium.en-GB.Malcolm',
        default: false,
        localService: true,
      },
      {
        name: 'Samantha',
        lang: 'en-US',
        voiceURI: 'com.apple.voice.enhanced.en-US.Samantha',
        default: false,
        localService: true,
      },
    ]
    const spoken: unknown[] = []
    Object.assign(window, { __spoken: spoken })
    class FakeUtterance extends EventTarget {
      text: string
      lang = ''
      rate = 1
      volume = 1
      voice: { voiceURI: string } | null = null
      onend: (() => void) | null = null
      onerror: (() => void) | null = null
      constructor(text: string) {
        super()
        this.text = text
      }
    }
    const synth = Object.assign(new EventTarget(), {
      getVoices: () => voices,
      cancel: () => {},
      speak: (u: FakeUtterance) => {
        spoken.push({ text: u.text, lang: u.lang, voice: u.voice?.voiceURI ?? null, rate: u.rate })
        setTimeout(() => u.onend?.(), 10)
      },
    })
    Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true })
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: FakeUtterance, configurable: true })
  })
}

const spoken = (page: Page) =>
  page.evaluate(() => (window as unknown as { __spoken: Spoken[] }).__spoken.filter((s) => s.text !== ''))

test.beforeEach(async ({ page }) => {
  await setUpApp(page)
  await stubSpeech(page)
  await page.goto('/decks')
  await seed(page, {
    decks: [deckRow('d1', 'English B2', { directions: 'forward' }), deckRow('d2', 'Polski', { target_lang: 'pl-PL' })],
    cards: [
      cardRow('c1', 'd1', 'take off', 'взлетать', { example: 'Planes take off.' }),
      cardRow('p1', 'd2', 'kot', 'кот'),
    ],
    card_states: [newStateRow('c1'), newStateRow('p1'), newStateRow('p1', 'reverse')],
  })
})

test('autoplay speaks the front once, in the deck language, with the best voice', async ({ page }) => {
  await page.goto('/study?deck=d1')
  await page.getByRole('button', { name: 'Start' }).click()
  await expect(page.getByRole('button', { name: /^Word: take off\./ })).toBeVisible()
  await expect
    .poll(() => spoken(page))
    .toEqual([{ text: 'take off', lang: 'en-GB', voice: 'com.apple.voice.premium.en-GB.Malcolm', rate: 1 }])
})

test('the Voices choice persists across reloads and is used for tap-to-speak', async ({ page }) => {
  await page.goto('/settings/voices')
  const english = page.getByRole('group', { name: 'British English' })
  await expect(english.getByRole('radio')).toHaveCount(4) // Automatic + 3 English voices
  await expect(english.getByText('en-GB · Premium')).toBeVisible()
  await english.getByRole('radio', { name: /Daniel/ }).check()

  await page.reload()
  await expect(
    page.getByRole('group', { name: 'British English' }).getByRole('radio', { name: /Daniel/ }),
  ).toBeChecked()
  await expect(page.getByText('No voices for this language on this device.')).toBeVisible() // Polish

  await page.goto('/cards/c1')
  await page.getByRole('button', { name: 'take off', exact: true }).click()
  await page.getByRole('button', { name: 'Planes take off.' }).click()
  await expect
    .poll(() => spoken(page))
    .toEqual([
      { text: 'take off', lang: 'en-GB', voice: 'com.apple.voice.compact.en-GB.Daniel', rate: 1 },
      { text: 'Planes take off.', lang: 'en-GB', voice: 'com.apple.voice.compact.en-GB.Daniel', rate: 1 },
    ])
})

test('warns about a language without a voice and still studies', async ({ page }) => {
  await page.goto('/study?deck=d2')
  const warning = page.getByRole('alert').filter({ hasText: 'No voice for Polish installed' })
  await expect(warning).toBeVisible()
  await page.getByRole('button', { name: 'Start' }).click()
  await expect(page.getByTestId('swipe-card')).toBeVisible()
  await expect.poll(() => spoken(page)).toEqual([{ text: 'kot', lang: 'pl-PL', voice: null, rate: 1 }])
})
