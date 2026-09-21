import { expect, type Page, test } from '@playwright/test'
import en from '../../src/i18n/en.json' with { type: 'json' }
import ru from '../../src/i18n/ru.json' with { type: 'json' }
import { cardRow, deckRow, newStateRow, seed, setUpApp } from './helpers'

// Walks every Phase 1 screen in both UI languages on the iPhone viewport: no untranslated key, no horizontal
// overflow, and a full-page screenshot per screen (test-results/…) to review truncated or clumsy strings.

test.skip(({ browserName }) => browserName !== 'webkit', 'the iPhone viewport is what matters')

const dictionaries = { en, ru } as const
type Dictionary = Record<string, unknown>

function translate(dictionary: Dictionary, key: string): string {
  const value = key.split('.').reduce<unknown>((node, part) => (node as Dictionary | undefined)?.[part], dictionary)
  if (typeof value !== 'string') throw new Error(`no string for ${key}`)
  return value
}

/** A raw key such as `today.start` on screen means a missing translation. */
const rawKey = new RegExp(`\\b(${Object.keys(en).join('|')})\\.[a-zA-Z]+`)

async function check(page: Page, name: string) {
  await page.waitForTimeout(300) // let enter animations settle before the screenshot
  const text = await page.locator('body').innerText()
  expect(text, `${name}: untranslated key`).not.toMatch(rawKey)
  expect(text, `${name}: unfilled placeholder`).not.toContain('{{')
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  await expect.poll(overflow, { message: `${name}: horizontal overflow` }).toBeLessThanOrEqual(0)
  await page.screenshot({ path: test.info().outputPath(`${name}.png`), fullPage: true })
}

for (const language of ['en', 'ru'] as const) {
  test(`every screen reads well in ${language}`, async ({ page }) => {
    const t = (key: string) => translate(dictionaries[language], key)

    // S-01 onboarding, first steps.
    await setUpApp(page, language, { onboarded: false })
    await page.goto('/')
    await check(page, '01-welcome')
    await page.getByRole('button', { name: t('onboarding.getStarted') }).click()
    await page.getByRole('radio').first().check()
    await check(page, '01-languages')
    await page.getByRole('button', { name: t('onboarding.next') }).click()
    await page.getByRole('button', { name: t('onboarding.goalCustom') }).click()
    await page.getByRole('textbox', { name: t('onboarding.goalCustomLabel') }).fill('300')
    await check(page, '01-goal')
    await page.getByRole('textbox', { name: t('onboarding.goalCustomLabel') }).fill('30')
    await page.getByRole('button', { name: t('onboarding.next') }).click()
    await check(page, '01-deck')

    await seed(page, {
      meta: [{ key: 'onboarding_done', value: true }],
      decks: [deckRow('d1', t('onboarding.appName'), { directions: 'forward' })],
      cards: [
        cardRow('c1', 'd1', 'take off', 'взлетать; снимать (одежду)', {
          example: 'The plane takes off at noon.',
          example_translation: 'Самолёт взлетает в полдень.',
          ipa: 'teɪk ɒf',
          tags: ['phrasal verbs'],
        }),
        cardRow('c2', 'd1', 'nevertheless', 'тем не менее'),
      ],
      card_states: [newStateRow('c1'), newStateRow('c2')],
    })

    const screens: [string, string][] = [
      ['04-today', '/'],
      ['05-decks', '/decks'],
      ['06-deck-detail', '/decks/d1'],
      ['07-card-view', '/cards/c1'],
      ['08-card-new', '/cards/new?deck=d1'],
      ['08-card-edit', '/cards/c1/edit'],
      ['10-import', '/import'],
      ['13-stats', '/stats'],
      ['14-settings', '/settings'],
      ['16-voices', '/settings/voices'],
    ]
    for (const [name, path] of screens) {
      await page.goto(path)
      await expect(page.locator('main')).not.toBeEmpty()
      await check(page, name)
    }

    // S-11 study and S-12 summary.
    await page.goto('/study?deck=d1')
    await check(page, '11-study-gate')
    await page.getByRole('button', { name: t('study.start') }).click()
    await expect(page.getByTestId('swipe-card')).toBeVisible()
    await check(page, '11-study-card')
    // One miss, so the summary lists a difficult word; then Know until the session ends.
    await page.getByRole('button', { name: t('study.dontKnow'), exact: true }).click()
    for (let answers = 0; answers < 20 && !page.url().includes('/study/summary'); answers++) {
      const before = await page.getByTestId('study-progress').textContent()
      await page.getByRole('button', { name: t('study.know'), exact: true }).click()
      await expect(async () => {
        const done = page.url().includes('/study/summary')
        expect(done || (await page.getByTestId('study-progress').textContent()) !== before).toBe(true)
      }).toPass()
    }
    await expect(page).toHaveURL(/\/study\/summary/)
    await check(page, '12-summary')
    await page.goto('/')
    await check(page, '04-today-after')
  })
}
