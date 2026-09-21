import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getMeta, setMeta } from '@/db/meta'
import { mockApi, setOnline } from '@/test/api'
import { resetDb } from '@/test/db'
import { useServerFeatures } from './serverFeatures'

const FEATURES = { tts: true, commons: false, enrich: false, push: false }

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

beforeEach(resetDb)
afterEach(() => {
  vi.unstubAllGlobals()
  setOnline(true)
})

describe('useServerFeatures', () => {
  it('fetches the features online and remembers them on this device', async () => {
    mockApi([{ path: '/api/meta', body: { version: '0.1.0', features: FEATURES } }])
    const { result } = renderHook(() => useServerFeatures(), { wrapper })
    await waitFor(() => expect(result.current).toEqual(FEATURES))
    expect(await getMeta('server_features')).toEqual(FEATURES)
  })

  it('uses the remembered features offline', async () => {
    await setMeta('server_features', FEATURES)
    const api = mockApi([])
    setOnline(false)
    const { result } = renderHook(() => useServerFeatures(), { wrapper })
    await waitFor(() => expect(result.current).toEqual(FEATURES))
    expect(api).not.toHaveBeenCalled()
  })

  it('is null until the server answered once', async () => {
    mockApi([])
    setOnline(false)
    const { result } = renderHook(() => useServerFeatures(), { wrapper })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(result.current).toBeNull()
  })
})
