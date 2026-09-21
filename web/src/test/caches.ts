import { vi } from 'vitest'

const path = (request: RequestInfo | URL) =>
  new URL(request instanceof Request ? request.url : String(request), 'http://localhost').pathname

/** An in-memory Cache Storage (jsdom has none). Returns the stores to inspect them. */
export function installFakeCaches() {
  const stores = new Map<string, Map<string, Response>>()
  const cache = (name: string) => {
    let store = stores.get(name)
    if (!store) {
      store = new Map()
      stores.set(name, store)
    }
    const entries = store
    return {
      match: async (request: RequestInfo | URL) => entries.get(path(request))?.clone(),
      put: async (request: RequestInfo | URL, response: Response) => {
        entries.set(path(request), response)
      },
      keys: async () => [...entries.keys()].map((key) => new Request(new URL(key, 'http://localhost'))),
    }
  }
  vi.stubGlobal('caches', {
    open: async (name: string) => cache(name),
    delete: async (name: string) => stores.delete(name),
    keys: async () => [...stores.keys()],
  })
  return stores
}

/** A clip as `GET /api/audio/{id}` answers it. */
export function clipResponse(source: 'azure' | 'commons', attribution?: string): Response {
  const headers: Record<string, string> = { 'Content-Type': 'audio/mpeg', 'X-Audio-Source': source }
  if (attribution) headers['X-Audio-Attribution'] = encodeURIComponent(attribution)
  return new Response(new Uint8Array([0x49, 0x44, 0x33]), { status: 200, headers })
}
