import { expect, type Page, test } from '@playwright/test'
import { setUpApp } from './helpers'
import { createAccount, outboxCount, ownAddress, SYNC_SERVER, signIn } from './server'

test.use(SYNC_SERVER)

test.beforeEach(async ({ context }) => {
  await ownAddress(context)
})

async function createDeck(page: Page, name: string) {
  // "Create deck" in the empty list, "New deck" in the header otherwise.
  await page
    .getByRole('button', { name: /^(Create deck|New deck)$/ })
    .first()
    .click()
  const sheet = page.getByRole('dialog', { name: 'New deck' })
  await sheet.getByLabel('Name').fill(name)
  await sheet.getByRole('radio', { name: 'Forward' }).click()
  await sheet.getByRole('button', { name: 'Create' }).click()
  await expect(page.getByRole('list', { name: 'Decks' }).getByText(name)).toBeVisible()
}

test('a change is pushed within seconds; offline changes wait and sync when back online', async ({
  page,
  context,
  playwright,
}) => {
  const account = await createAccount(playwright, 'pusher')
  await setUpApp(page)
  await signIn(page, account.email, account.password)
  await expect(page).toHaveURL(/\/settings\/account/)

  await page.getByRole('link', { name: 'Decks' }).click()
  await createDeck(page, 'Synced deck')
  await expect.poll(() => outboxCount(page), { timeout: 5_000 }).toBe(0)
  await page.getByRole('link', { name: 'Today' }).click()
  await expect(page.locator('a[data-state]')).toHaveAttribute('data-state', 'synced')

  await context.setOffline(true)
  await page.getByRole('link', { name: 'Decks' }).click()
  await createDeck(page, 'Offline deck')
  await page.getByRole('link', { name: 'Today' }).click()
  await expect(page.locator('a[data-state]')).toHaveAttribute('data-state', 'offline')
  await page.locator('a[data-state]').click()
  await expect(page.getByTestId('pending-count')).toHaveText('1')
  await expect(page.getByRole('button', { name: 'Sync now' })).toBeDisabled()

  await context.setOffline(false)
  await expect(page.getByTestId('pending-count')).toHaveText('0', { timeout: 10_000 })
  await expect(page.getByText(/sent 1, received/).first()).toBeAttached()
})
