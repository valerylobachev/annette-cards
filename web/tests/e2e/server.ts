import type { BrowserContext, Page } from '@playwright/test'

/** The admin created by the API web server in playwright.config.ts. */
export const ADMIN = { email: 'admin@e2e.test', password: 'admin password 1' }

/** `test.use(SYNC_SERVER)`: run the file's tests against the HTTPS dev server that proxies to the test API server. */
export const SYNC_SERVER = { baseURL: 'https://localhost:5174', ignoreHTTPSErrors: true }

/**
 * Gives a browser context its own client address. The server allows 10 sign-in attempts a minute per IP and reads
 * the IP from `X-Forwarded-For` (set by Caddy in production); without this, all tests would share one budget.
 */
export async function ownAddress(context: BrowserContext) {
  const part = () => Math.floor(Math.random() * 250) + 1
  await context.setExtraHTTPHeaders({ 'x-forwarded-for': `10.${part()}.${part()}.${part()}` })
}

/** A unique email for an account created by a test (the test server's database lives across runs locally). */
export function uniqueEmail(name: string): string {
  return `${name}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@e2e.test`
}

/** Signs in through S-02. */
export async function signIn(page: Page, email: string, password: string) {
  await page.goto('/signin')
  const form = page.getByRole('form', { name: 'Sign in' })
  await form.getByLabel('Email').fill(email)
  await form.getByLabel('Password', { exact: true }).fill(password)
  await form.getByRole('button', { name: 'Sign in' }).click()
}
