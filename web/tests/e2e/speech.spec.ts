import { expect, test } from '@playwright/test'
import { cardRow, deckRow, newStateRow, seed, setUpApp, spoken, stubSpeech } from './helpers'

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
