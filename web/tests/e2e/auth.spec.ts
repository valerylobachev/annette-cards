import { expect, test } from '@playwright/test'
import { setUpApp } from './helpers'
import { ADMIN, ownAddress, SYNC_SERVER, signIn, uniqueEmail } from './server'

test.use(SYNC_SERVER)

test.beforeEach(async ({ context }) => {
  await ownAddress(context)
})

test('an admin invites someone who registers with the link', async ({ page, browser }) => {
  await setUpApp(page)
  await signIn(page, ADMIN.email, ADMIN.password)
  await expect(page).toHaveURL(/\/settings\/account/)
  await expect(page.getByText(ADMIN.email)).toBeVisible()

  await page.getByRole('button', { name: 'Create invite' }).click()
  await page.getByLabel('Who is it for? (optional)').fill('Anna')
  await page.getByRole('button', { name: 'Create', exact: true }).click()
  const link = (await page.getByLabel('Invite link').textContent()) ?? ''
  expect(link).toMatch(/\/register\?invite=[A-Z0-9]{12}$/)

  const invitee = await browser.newContext({ ignoreHTTPSErrors: true })
  await ownAddress(invitee)
  const other = await invitee.newPage()
  await setUpApp(other)
  await other.goto(link)
  const code = link.split('=')[1] ?? ''
  const form = other.getByRole('form', { name: 'Register' })
  await expect(form.getByLabel('Invite code')).toHaveValue(code)
  const email = uniqueEmail('anna')
  await form.getByLabel('Your name').fill('Anna')
  await form.getByLabel('Email').fill(email)
  await form.getByLabel('Password', { exact: true }).fill('anna password 1')
  await form.getByRole('button', { name: 'Create account' }).click()
  await expect(other).toHaveURL(/\/settings\/account/)
  await expect(other.getByText(email)).toBeVisible()
  await invitee.close()

  await page.keyboard.press('Escape')
  await page.reload()
  const invite = page.getByRole('list', { name: 'Invites' }).getByRole('listitem').filter({ hasText: code })
  await expect(invite).toContainText(`Used by ${email}`)
})

test('a wrong password shows the translated error', async ({ page }) => {
  await setUpApp(page, 'ru')
  await page.goto('/signin')
  const form = page.getByRole('form', { name: 'Вход' })
  await form.getByLabel('Эл. почта').fill(ADMIN.email)
  await form.getByLabel('Пароль', { exact: true }).fill('not the password')
  await form.getByRole('button', { name: 'Войти' }).click()
  await expect(page.getByRole('alert')).toHaveText('Неверная почта или пароль.')
})

test('the sign-in form is disabled offline', async ({ page, context }) => {
  await setUpApp(page)
  await page.goto('/signin')
  await context.setOffline(true)
  await expect(page.getByText('Connect to the internet to sign in.')).toBeVisible()
  await expect(page.getByRole('form', { name: 'Sign in' }).getByLabel('Email')).toBeDisabled()
  await context.setOffline(false)
})
