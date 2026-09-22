import { expect, type Page, test } from '@playwright/test'
import { cardRow, deckRow, newStateRow, seed, setUpApp, stubSpeech } from './helpers'

// README and user-guide screenshots (P4-T07): a demo account on an iPhone viewport, light theme, in English and
// Russian. Not part of `just e2e`: `just screenshots` runs it (the `screenshots` project in playwright.config.ts)
// and writes the PNGs to docs/images/.

const DAY = 86_400_000
const OUT = new URL('../../../docs/images/', import.meta.url).pathname

const ENGLISH: [string, string, string][] = [
  ['to take off', 'взлетать; снимать (одежду)', 'The plane took off at 6 am.'],
  ['reluctant', 'неохотный', 'She was reluctant to leave.'],
  ['to come across', 'наткнуться, встретить', 'I came across an old photo.'],
  ['thorough', 'тщательный', 'The doctor was very thorough.'],
  ['to put up with', 'мириться, терпеть', 'I can’t put up with the noise.'],
  ['eventually', 'в конце концов', 'Eventually, we found the hotel.'],
  ['to get along', 'ладить', 'They get along well.'],
  ['to look forward to', 'с нетерпением ждать', 'I look forward to seeing you.'],
  ['sufficient', 'достаточный', 'We have sufficient time.'],
  ['to figure out', 'разобраться, понять', 'I can’t figure out this map.'],
  ['anxious', 'тревожный, обеспокоенный', 'He was anxious about the exam.'],
  ['to turn down', 'отклонить; убавить', 'She turned down the offer.'],
  ['obvious', 'очевидный', 'The answer was obvious.'],
  ['to run out of', 'закончиться (о запасах)', 'We ran out of milk.'],
  ['meanwhile', 'тем временем', 'Meanwhile, the kettle boiled.'],
  ['to bring up', 'поднимать (тему); воспитывать', 'Don’t bring up politics.'],
  ['keen', 'увлечённый, заинтересованный', 'He is keen on football.'],
  ['to carry on', 'продолжать', 'Carry on with your work.'],
  ['approach', 'подход', 'We need a new approach.'],
  ['to set up', 'устанавливать, организовать', 'They set up a company.'],
]
const POLISH: [string, string][] = [
  ['żółw', 'черепаха'],
  ['dziękuję', 'спасибо'],
  ['jabłko', 'яблоко'],
  ['szczęście', 'счастье'],
  ['pociąg', 'поезд'],
  ['chleb', 'хлеб'],
]

/** A small deterministic generator, so every run draws the same screenshots. */
function random(seed: number) {
  let state = seed
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648
    return state / 2_147_483_648
  }
}

function logRow(id: string, card_id: string, reviewed_at: number, rating: number) {
  return {
    id,
    card_id,
    direction: 'forward',
    rating,
    mode: 'swipe',
    state_before: {
      state: 2,
      due: 0,
      stability: 10,
      difficulty: 5,
      elapsed_days: 3,
      scheduled_days: 3,
      learning_steps: 0,
      reps: 3,
      lapses: 0,
      last_review: 0,
    },
    reviewed_at,
    duration_ms: 4_000,
    practice: false,
    updated_at: 1,
    updated_by: 'demo',
    deleted_at: null,
  }
}

/** Two decks studied for about two months: some words due today, some new, answers on most days. */
function demoAccount(now: number) {
  const next = random(7)
  const english = ENGLISH.map(([front, back, example], i) =>
    cardRow(`en-${i}`, 'english', front, back, { example, created_at: now - (60 - i) * DAY, tags: ['B2'] }),
  )
  const polish = POLISH.map(([front, back], i) => cardRow(`pl-${i}`, 'polish', front, back, { created_at: now - i }))
  const states = [
    ...english.flatMap((card, i) =>
      (['forward', 'reverse'] as const).map((direction) => {
        const id = card.id as string
        // The last four words are new; of the others, every third is due today.
        if (i >= 16) return newStateRow(id, direction)
        const due = i % 3 === 0 ? now - DAY : now + Math.round(1 + next() * 40) * DAY
        const scheduled = Math.round(3 + next() * 40)
        return newStateRow(id, direction, {
          state: 2,
          due,
          stability: scheduled,
          difficulty: 3 + next() * 5,
          scheduled_days: scheduled,
          reps: 3 + Math.floor(next() * 6),
          last_review: due - scheduled * DAY,
        })
      }),
    ),
    ...polish.map((card) => newStateRow(card.id as string)),
    ...polish.map((card) => newStateRow(card.id as string, 'reverse')),
  ]
  const logs = []
  const noon = new Date(now)
  noon.setHours(12, 0, 0, 0)
  for (let day = 60; day >= 1; day--) {
    // A missed day now and then, but the last 12 days in a row.
    if (day > 12 && next() < 0.2) continue
    const answers = 8 + Math.floor(next() * 25)
    for (let n = 0; n < answers; n++) {
      const card = Math.floor(next() * 16)
      const roll = next()
      const rating = roll < 0.1 ? 1 : roll < 0.2 ? 2 : roll < 0.9 ? 3 : 4
      logs.push(logRow(`log-${day}-${n}`, `en-${card}`, noon.getTime() - day * DAY + n * 60_000, rating))
    }
  }
  return {
    decks: [
      deckRow('english', 'English — B2', { directions: 'both', created_at: now - 60 * DAY }),
      deckRow('polish', 'Polski', { target_lang: 'pl-PL', directions: 'both', created_at: now - DAY }),
    ],
    cards: [...english, ...polish],
    card_states: states,
    review_log: logs,
  }
}

async function shoot(page: Page, name: string, language: string) {
  // Let transitions and fonts settle.
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${OUT}${name}-${language}.png` })
}

test.use({ colorScheme: 'light', deviceScaleFactor: 2 })

for (const language of ['en', 'ru'] as const) {
  test(`screenshots in ${language} @screenshots`, async ({ page }) => {
    await stubSpeech(page)
    // As on the installed iPhone app: storage is persistent, so no "Safari may remove your data" warning.
    await page.addInitScript(() => {
      if (navigator.storage) Object.defineProperty(navigator.storage, 'persisted', { value: async () => true })
    })
    await setUpApp(page, language)
    await seed(page, demoAccount(Date.now()))

    await page.goto('/')
    await expect(page.locator('main')).toBeVisible()
    await shoot(page, 'today', language)

    await page.goto('/decks/english')
    await expect(page.getByRole('list').first()).toBeVisible()
    await shoot(page, 'deck', language)

    await page.goto('/stats')
    await expect(page.locator('main')).toBeVisible()
    await shoot(page, 'statistics', language)

    await page.goto('/settings')
    await expect(page.locator('main')).toBeVisible()
    await shoot(page, 'settings', language)

    await page.goto('/study?deck=english&mode=swipe')
    await page.getByRole('button', { name: language === 'en' ? 'Start' : 'Начать' }).click()
    await expect(page.getByRole('button', { name: /^(Word|Слово):/ })).toBeVisible()
    await shoot(page, 'study', language)
  })
}
