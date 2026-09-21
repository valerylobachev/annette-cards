import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { me } from '@/api/endpoints/auth/auth'
import en from '@/i18n/en.json'
import ru from '@/i18n/ru.json'
import { mockApi } from '@/test/api'
import { ApiError, apiErrorCode, callApi, isUnauthorized } from './api'
import { API_ERROR_CODES, errorMessageKey } from './apiErrors'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('callApi', () => {
  it('returns the data of a 2xx response', async () => {
    mockApi([{ path: '/api/auth/me', body: { id: 'u1' } }])
    await expect(callApi(() => me())).resolves.toEqual({ id: 'u1' })
  })

  it('throws the server error code with the status', async () => {
    mockApi([{ path: '/api/auth/me', status: 401, body: { code: 'unauthorized', details: null } }])
    const error = await callApi(() => me()).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(ApiError)
    expect(apiErrorCode(error)).toBe('unauthorized')
    expect(isUnauthorized(error)).toBe(true)
  })

  it('reports an unreachable server or a non-JSON answer as network', async () => {
    mockApi([])
    await expect(callApi(() => me())).rejects.toMatchObject({ status: 0, code: 'network' })
    vi.stubGlobal('fetch', async () => new Response('<html>Bad gateway</html>', { status: 502 }))
    await expect(callApi(() => me())).rejects.toMatchObject({ code: 'network' })
  })

  it('reports an error body without a code as unknown', async () => {
    vi.stubGlobal('fetch', async () => new Response('{}', { status: 500 }))
    await expect(callApi(() => me())).rejects.toMatchObject({ status: 500, code: 'unknown' })
  })
})

describe('error messages', () => {
  const lookup = (dictionary: object, key: string) =>
    key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], dictionary)

  it('has a text for every known code in both languages', () => {
    for (const code of API_ERROR_CODES) {
      expect(lookup(en, `errors.${code}`), `en ${code}`).toEqual(expect.any(String))
      expect(lookup(ru, `errors.${code}`), `ru ${code}`).toEqual(expect.any(String))
    }
  })

  it('knows every error code the server documents (architecture.md §5.3)', () => {
    // Vitest runs in web/.
    const doc = readFileSync(path.resolve(process.cwd(), '../docs/architecture.md'), 'utf8')
    const documented = [...doc.matchAll(/^\| `([a-z_]+)` \| \d{3} \|/gm)].map((match) => match[1])
    expect(documented.length).toBeGreaterThan(10)
    for (const code of documented) expect(API_ERROR_CODES, code).toContain(code)
  })

  it('falls back to errors.unknown', () => {
    expect(errorMessageKey('invite_expired')).toBe('errors.invite_expired')
    expect(errorMessageKey('something_new')).toBe('errors.unknown')
  })
})
