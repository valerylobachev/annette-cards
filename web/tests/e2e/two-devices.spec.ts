import { type Browser, expect, type Page, test } from '@playwright/test'
import { cardRow, deckRow, newStateRow, seed, setUpApp } from './helpers'
import { createAccount, outboxCount, ownAddress, readAll, SYNC_SERVER, signIn } from './server'

// P2-T07: two (then three) devices of one account sync edits and study progress through the test server.

test.use(SYNC_SERVER)

async function newDevice(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ ...SYNC_SERVER })
  await ownAddress(context)
  const page = await context.newPage()
  await setUpApp(page)
  return page
}

/** Waits until the debounced sync after a local change has pushed everything. */
async function synced(page: Page) {
  await expect.poll(() => outboxCount(page), { timeout: 10_000 }).toBe(0)
}

/** Syncs now through S-15 and waits for the run to finish. */
async function syncNow(page: Page) {
  await page.goto('/settings/account')
  const button = page.getByRole('button', { name: 'Sync now' })
  await button.click()
  await expect(button).toBeEnabled()
  await synced(page)
}

test('devices of one account share decks, progress and the last edit', async ({ browser, playwright }) => {
  test.slow()
  const account = await createAccount(playwright, 'family')
  const suffix = `${test.info().project.name}-${Date.now()}`
  const deckId = `deck-${suffix}`
  const cardIds = [1, 2, 3].map((n) => `card-${n}-${suffix}`)

  // 1. Device A has a deck with three cards before signing in to the empty account: everything is pushed.
  const a = await newDevice(browser)
  await seed(a, {
    decks: [deckRow(deckId, 'Shared deck', { directions: 'forward' })],
    cards: cardIds.map((id, i) => cardRow(id, deckId, `word ${i + 1}`, `слово ${i + 1}`, { created_at: i + 1 })),
    card_states: cardIds.map((id) => newStateRow(id)),
  })
  await signIn(a, account.email, account.password)
  await expect(a.getByRole('heading', { name: 'Hi, family!' })).toBeVisible()
  await synced(a)

  // B signs in on a fresh device and receives them.
  const b = await newDevice(browser)
  await signIn(b, account.email, account.password)
  await expect(b.getByRole('heading', { name: 'Hi, family!' })).toBeVisible()
  await b.goto(`/decks/${deckId}`)
  await expect(b.getByText('word 1')).toBeVisible()
  await expect(b.getByText('word 3')).toBeVisible()

  // 2. B studies one card; A gets the new state and the review.
  await b.goto(`/study?deck=${deckId}`)
  await b.getByRole('button', { name: 'Start' }).click()
  await b.getByRole('button', { name: 'Know', exact: true }).click()
  await expect.poll(async () => (await readAll(b, 'review_log')).length).toBe(1)
  await synced(b)
  await syncNow(a)
  await expect.poll(async () => (await readAll(a, 'review_log')).length).toBe(1)
  const states = await readAll(a, 'card_states')
  expect(states.filter((state) => (state.reps as number) > 0)).toHaveLength(1)

  // 3. Both edit the same card offline, A first; after reconnecting both keep B's later edit.
  const edit = async (page: Page, back: string) => {
    await page.goto(`/cards/${cardIds[1]}/edit`)
    await page.context().setOffline(true)
    await page.getByLabel('Translation *').fill(back)
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page).not.toHaveURL(/\/edit/)
  }
  await edit(a, 'версия A')
  await edit(b, 'версия B')
  await a.context().setOffline(false)
  await synced(a)
  await b.context().setOffline(false)
  await synced(b)
  await syncNow(a)
  for (const page of [a, b]) {
    await page.goto(`/cards/${cardIds[1]}`)
    await expect(page.getByText('версия B')).toBeVisible()
  }

  // 4. Device C has its own local deck: S-03 offers the choice, and Merge keeps both.
  const c = await newDevice(browser)
  await seed(c, {
    decks: [deckRow(`local-${suffix}`, 'Local deck', { directions: 'forward' })],
    cards: [cardRow(`local-card-${suffix}`, `local-${suffix}`, 'local word', 'местное слово')],
    card_states: [newStateRow(`local-card-${suffix}`)],
  })
  await signIn(c, account.email, account.password)
  await expect(c.getByText('1 deck, 1 card')).toBeVisible()
  await expect(c.getByText('1 deck, 3 cards')).toBeVisible()
  await c.getByRole('button', { name: 'Merge (recommended)' }).click()
  await expect(c.getByRole('heading', { name: 'Hi, family!' })).toBeVisible()
  await c.goto('/decks')
  const decks = c.getByRole('list', { name: 'Decks' })
  await expect(decks.getByText('Shared deck')).toBeVisible()
  await expect(decks.getByText('Local deck')).toBeVisible()
  await synced(c)
  await syncNow(a)
  await a.goto('/decks')
  await expect(a.getByRole('list', { name: 'Decks' }).getByText('Local deck')).toBeVisible()

  // 5. Signing out with a change that could not be synced asks first.
  await a.goto(`/cards/${cardIds[0]}/edit`)
  await a.context().setOffline(true)
  await a.getByLabel('Translation *').fill('не отправлено')
  await a.getByRole('button', { name: 'Save', exact: true }).click()
  await a.getByRole('link', { name: 'Settings' }).click()
  await a.getByRole('link', { name: /family/ }).click()
  await a.getByRole('button', { name: 'Sign out', exact: true }).click()
  await expect(a.getByText('1 change is not synced')).toBeVisible()
  await a.getByRole('button', { name: 'Cancel' }).click()
  await a.context().setOffline(false)

  // 6. A synced device signs out without a question; its data is gone and onboarding opens.
  await b.goto('/settings/account')
  await b.getByRole('button', { name: 'Sign out', exact: true }).click()
  await expect(b).toHaveURL(/\/welcome/)
  expect(await readAll(b, 'decks')).toEqual([])
  expect(await readAll(b, 'outbox')).toEqual([])
  expect(
    await b.evaluate(async () => (await caches.keys()).filter((key) => !key.startsWith('workbox-precache'))),
  ).toEqual([])
})
