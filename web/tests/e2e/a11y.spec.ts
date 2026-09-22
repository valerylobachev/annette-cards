import AxeBuilder from '@axe-core/playwright'
import { expect, type Page, test } from '@playwright/test'
import { cardRow, deckRow, newStateRow, seed, setUpApp } from './helpers'

// P4-T06 accessibility gate: axe (WCAG 2 A/AA rules) on every main screen in light and dark themes; no serious or
// critical violation is allowed (contrast, names, roles, labels).

const WORDS = ['cat', 'dog', 'bird', 'fish', 'horse']

async function expectAccessible(page: Page, screen: string) {
  // Let transitions and the theme settle, so colors are measured at rest.
  await page.waitForTimeout(300)
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  const serious = violations
    .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
    .map(({ id, impact, help, nodes }) => ({
      id,
      impact,
      help,
      targets: nodes.slice(0, 5).map((node) => `${node.target.join(' ')} — ${node.failureSummary ?? ''}`),
    }))
  expect(serious, `${screen}: ${JSON.stringify(serious, null, 2)}`).toEqual([])
}

/** Forgets the resumable session, so the next study page starts a new one. */
async function forgetSession(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('annette')
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          const tx = request.result.transaction('meta', 'readwrite')
          tx.objectStore('meta').delete('study_session')
          tx.oncomplete = () => {
            request.result.close()
            resolve()
          }
        }
      }),
  )
}

for (const theme of ['light', 'dark'] as const) {
  test.describe(`${theme} theme`, () => {
    test.use({ colorScheme: theme })

    test.beforeEach(async ({ page }) => {
      await setUpApp(page)
      await seed(page, {
        decks: [deckRow('d1', 'English', { directions: 'both' }), deckRow('d2', 'Polish', { target_lang: 'pl-PL' })],
        cards: [
          ...WORDS.map((word, i) =>
            cardRow(`c${i}`, 'd1', word, `${word}-ru`, {
              example: `The ${word} sleeps.`,
              ipa: `/${word}/`,
              tags: ['animals'],
              created_at: i + 1,
            }),
          ),
          cardRow('p1', 'd2', 'kot', 'кот'),
        ],
        card_states: [
          ...WORDS.flatMap((_, i) => [newStateRow(`c${i}`), newStateRow(`c${i}`, 'reverse')]),
          newStateRow('p1'),
          newStateRow('p1', 'reverse'),
        ],
        review_log: [],
      })
    })

    test('main screens', async ({ page }) => {
      const screens: [string, string][] = [
        ['Today', '/'],
        ['Decks', '/decks'],
        ['Deck detail', '/decks/d1'],
        ['Card view', '/cards/c0'],
        ['Card editor', '/cards/c0/edit'],
        ['New card', '/cards/new?deck=d1'],
        ['Import', '/import'],
        ['Statistics', '/stats'],
        ['Settings', '/settings'],
        ['Account & sync', '/settings/account'],
        ['Voices', '/settings/voices'],
        ['Sign in', '/signin'],
        ['Welcome', '/welcome'],
      ]
      for (const [screen, path] of screens) {
        await page.goto(path)
        await expect(page.locator('main')).toBeVisible()
        await expectAccessible(page, screen)
      }
    })

    test('study modes and the summary', async ({ page }) => {
      for (const mode of ['swipe', 'choice', 'listening', 'typing']) {
        await forgetSession(page)
        await page.goto(`/study?deck=d1&mode=${mode}`)
        await expectAccessible(page, `Study start (${mode})`)
        await page.getByRole('button', { name: 'Start' }).click()
        await expectAccessible(page, `Study ${mode}`)
      }
      await forgetSession(page)
      await page.goto('/study?deck=d2&mode=swipe')
      await page.getByRole('button', { name: 'Start' }).click()
      for (let i = 0; i < 2 && !page.url().includes('/study/summary'); i++) {
        await page.getByRole('button', { name: 'Know', exact: true }).click()
        await page.waitForTimeout(400)
      }
      await expect(page).toHaveURL(/\/study\/summary/)
      await expectAccessible(page, 'Summary')
    })
  })
}
