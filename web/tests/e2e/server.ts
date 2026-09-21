import type { APIResponse, BrowserContext, Page, request } from '@playwright/test'

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

/** A fresh account (invited by the admin through the API), so tests running in parallel never share data. */
export async function createAccount(
  playwright: { request: typeof request },
  name = 'user',
): Promise<{ email: string; password: string; name: string }> {
  const baseURL = SYNC_SERVER.baseURL
  const headers = () => ({ origin: baseURL, 'x-forwarded-for': `10.9.${randomPart()}.${randomPart()}` })
  const admin = await playwright.request.newContext({ baseURL, ignoreHTTPSErrors: true, extraHTTPHeaders: headers() })
  await expectOk(admin.post('/api/auth/login', { data: ADMIN }))
  const invite = await (await expectOk(admin.post('/api/admin/invites', { data: {} }))).json()
  await admin.dispose()

  const account = { email: uniqueEmail(name), password: `${name} password 1`, name }
  const user = await playwright.request.newContext({ baseURL, ignoreHTTPSErrors: true, extraHTTPHeaders: headers() })
  await expectOk(
    user.post('/api/auth/register', {
      data: { invite_code: invite.code, display_name: name, email: account.email, password: account.password },
    }),
  )
  await user.dispose()
  return account
}

function randomPart() {
  return Math.floor(Math.random() * 250) + 1
}

async function expectOk(response: Promise<APIResponse>): Promise<APIResponse> {
  const answer = await response
  if (!answer.ok()) throw new Error(`${answer.url()} → ${answer.status()} ${await answer.text()}`)
  return answer
}

/** Rows waiting in the outbox of the page's app. */
export async function outboxCount(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const request = indexedDB.open('annette')
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          const count = request.result.transaction('outbox').objectStore('outbox').count()
          count.onsuccess = () => {
            request.result.close()
            resolve(count.result)
          }
          count.onerror = () => reject(count.error)
        }
      }),
  )
}

/** Rows of one object store of the page's app (soft-deleted ones included). */
export async function readAll(page: Page, store: string): Promise<Record<string, unknown>[]> {
  return page.evaluate(
    (name) =>
      new Promise<Record<string, unknown>[]>((resolve, reject) => {
        const request = indexedDB.open('annette')
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          const all = request.result.transaction(name).objectStore(name).getAll()
          all.onsuccess = () => {
            request.result.close()
            resolve(all.result)
          }
          all.onerror = () => reject(all.error)
        }
      }),
    store,
  )
}
