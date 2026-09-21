import { vi } from 'vitest'

export type MockRoute = {
  method?: string
  path: string
  status?: number
  body?: unknown
  /** Computes the answer from the request (JSON body, URL); wins over `body`. */
  respond?: (request: { body: unknown; url: URL }) => unknown | Promise<unknown>
}

/**
 * Replaces `fetch` with fixed answers per method and path (query strings ignored); unknown requests fail like a
 * network error. Returns the mock to inspect calls.
 */
export function mockApi(routes: MockRoute[]) {
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost')
    const method = (init?.method ?? 'GET').toUpperCase()
    const route = routes.find((r) => (r.method ?? 'GET') === method && r.path === url.pathname)
    if (!route) throw new TypeError(`no mock for ${method} ${url.pathname}`)
    const status = route.status ?? 200
    const sent = init?.body ? JSON.parse(String(init.body)) : null
    const answer = route.respond ? await route.respond({ body: sent, url }) : route.body
    const body = answer === undefined ? null : JSON.stringify(answer)
    return new Response(status === 204 ? null : body, { status, headers: { 'Content-Type': 'application/json' } })
  })
  vi.stubGlobal('fetch', mock)
  return mock
}

/** The JSON bodies sent to `path`. */
export function sentBodies(mock: ReturnType<typeof mockApi>, path: string): unknown[] {
  return mock.mock.calls
    .filter(([input]) => new URL(String(input), 'http://localhost').pathname === path)
    .map(([, init]) => (init?.body ? JSON.parse(String(init.body)) : null))
}

/** Simulates losing or regaining the connection. */
export function setOnline(online: boolean) {
  Object.defineProperty(navigator, 'onLine', { value: online, configurable: true })
  window.dispatchEvent(new Event(online ? 'online' : 'offline'))
}

export const ME = {
  id: 'user-1',
  email: 'anna@example.com',
  display_name: 'Anna',
  is_admin: false,
  created_at: 1,
}
