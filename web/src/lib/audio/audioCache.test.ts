import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clipResponse, installFakeCaches } from '@/test/caches'
import {
  AUDIO_CACHE,
  audioDetails,
  cachedAudioInfo,
  cachedOrDownloaded,
  clearAudioCache,
  download,
  getCached,
} from './audioCache'

let stores: ReturnType<typeof installFakeCaches>

beforeEach(() => {
  stores = installFakeCaches()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('audio cache', () => {
  it('caches a downloaded clip under its URL', async () => {
    const fetch = vi.fn(async () => clipResponse('azure'))
    vi.stubGlobal('fetch', fetch)
    const response = await download('a1')
    expect(response.status).toBe(200)
    expect(fetch).toHaveBeenCalledWith('/api/audio/a1', { credentials: 'same-origin' })
    expect([...(stores.get(AUDIO_CACHE)?.keys() ?? [])]).toEqual(['/api/audio/a1'])
    expect(await getCached('a1')).toBeDefined()
  })

  it('does not cache errors', async () => {
    vi.stubGlobal('fetch', async () => new Response('{"code":"not_found"}', { status: 404 }))
    expect((await download('gone')).status).toBe(404)
    expect(await getCached('gone')).toBeUndefined()
  })

  it('uses the cache before the network, and nothing offline', async () => {
    const fetch = vi.fn(async () => clipResponse('azure'))
    vi.stubGlobal('fetch', fetch)
    await download('a1')
    await cachedOrDownloaded('a1')
    expect(fetch).toHaveBeenCalledTimes(1)

    vi.stubGlobal('navigator', { ...navigator, onLine: false })
    expect(await cachedOrDownloaded('a2')).toBeUndefined()
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('clears every clip', async () => {
    vi.stubGlobal('fetch', async () => clipResponse('azure'))
    await download('a1')
    await clearAudioCache()
    expect(await getCached('a1')).toBeUndefined()
    expect((await cachedAudioInfo()).count).toBe(0)
  })

  it('reads the source and the percent-encoded attribution', async () => {
    const attribution = 'Derbeth · CC BY 2.5 · https://commons.wikimedia.org/wiki/File:Pl-%C5%BC%C3%B3%C5%82w.ogg'
    expect(audioDetails(clipResponse('commons', attribution))).toEqual({ source: 'commons', attribution })
    expect(audioDetails(clipResponse('azure'))).toEqual({ source: 'azure', attribution: null })
  })

  it('lists the attributions of cached recordings once each', async () => {
    const answers: Record<string, Response> = {
      '/api/audio/r1': clipResponse('commons', 'Żaneta · CC BY-SA 4.0'),
      '/api/audio/r2': clipResponse('commons', 'Derbeth · CC BY 2.5'),
      '/api/audio/r3': clipResponse('commons', 'Derbeth · CC BY 2.5'),
      '/api/audio/t1': clipResponse('azure'),
    }
    vi.stubGlobal('fetch', async (url: string) => answers[url])
    for (const id of ['r1', 'r2', 'r3', 't1']) await download(id)
    expect(await cachedAudioInfo()).toEqual({
      count: 4,
      attributions: ['Derbeth · CC BY 2.5', 'Żaneta · CC BY-SA 4.0'],
    })
  })
})
