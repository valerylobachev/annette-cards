import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setMeta } from '@/db/meta'
import { ME, type MockRoute, mockApi, sentBodies, setOnline } from '@/test/api'
import { resetDb } from '@/test/db'
import { useEnrich } from './useEnrich'

const FEATURES = { tts: false, commons: false, enrich: true, push: false }
const SUGGESTION = {
  back: 'черепаха',
  example: 'Żółw jest powolny.',
  example_translation: 'Черепаха медленная.',
  ipa: '/ʐuf/',
  notes: 'сущ., м. р.',
}
const INPUT = { front: 'żółw', target_lang: 'pl-PL', native_lang: 'ru' }

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

function mockServer(enrich: Omit<MockRoute, 'method' | 'path'>, features = FEATURES) {
  return mockApi([
    { method: 'POST', path: '/api/enrich', ...enrich },
    { path: '/api/meta', body: { version: '0.1.0', features } },
  ])
}

async function signIn() {
  await setMeta('account', { user_id: ME.id, email: ME.email, display_name: ME.display_name, is_admin: false })
}

beforeEach(resetDb)
afterEach(() => {
  vi.unstubAllGlobals()
  setOnline(true)
})

describe('useEnrich', () => {
  it('returns the suggestions for a word', async () => {
    await signIn()
    const api = mockServer({ body: SUGGESTION })
    const { result } = renderHook(() => useEnrich(), { wrapper })
    await waitFor(() => expect(result.current.canEnrich).toBe(true))

    await act(async () => {
      await expect(result.current.suggest(INPUT)).resolves.toEqual(SUGGESTION)
    })
    await waitFor(() => expect(result.current.data).toEqual(SUGGESTION))
    expect(result.current.error).toBeNull()
    expect(sentBodies(api, '/api/enrich')).toEqual([INPUT])
  })

  it('normalizes a quota error to its code and does not retry', async () => {
    await signIn()
    const api = mockServer({ status: 429, body: { code: 'enrich_quota_exceeded', details: null } })
    const { result } = renderHook(() => useEnrich(), { wrapper })
    await waitFor(() => expect(result.current.canEnrich).toBe(true))

    await act(async () => {
      await expect(result.current.suggest(INPUT)).rejects.toThrow()
    })
    await waitFor(() => expect(result.current.error).toBe('enrich_quota_exceeded'))
    expect(sentBodies(api, '/api/enrich')).toHaveLength(1)
  })

  it('reports an unreachable server as network', async () => {
    await signIn()
    mockApi([{ path: '/api/meta', body: { version: '0.1.0', features: FEATURES } }])
    const { result } = renderHook(() => useEnrich(), { wrapper })
    await waitFor(() => expect(result.current.canEnrich).toBe(true))

    await act(async () => {
      await expect(result.current.suggest(INPUT)).rejects.toThrow()
    })
    await waitFor(() => expect(result.current.error).toBe('network'))
  })

  it('is available only when signed in and offered by the server, and usable only online', async () => {
    mockServer({ body: SUGGESTION })
    const { result } = renderHook(() => useEnrich(), { wrapper })
    await waitFor(() => expect(result.current.available).toBe(false))

    await signIn()
    await waitFor(() => expect(result.current.canEnrich).toBe(true))
    act(() => setOnline(false))
    expect(result.current.available).toBe(true)
    expect(result.current.canEnrich).toBe(false)
  })

  it('is unavailable when the server has no enrichment', async () => {
    await signIn()
    mockServer({ body: SUGGESTION }, { ...FEATURES, enrich: false })
    const { result } = renderHook(() => useEnrich(), { wrapper })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(result.current.available).toBe(false)
  })
})
