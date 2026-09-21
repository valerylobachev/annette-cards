/**
 * Server audio clips in Cache Storage (architecture.md §4.5, §4.7). The service worker caches `/api/audio/*` in the
 * same cache (CacheFirst), so a clip downloaded by either is found by both. Clips never change (a new clip gets a
 * new id), so a cached one is used forever.
 */

export const AUDIO_CACHE = 'audio-v1'

/** Where a clip came from (`X-Audio-Source`). */
export type AudioSource = 'azure' | 'commons'

export type AudioDetails = { source: AudioSource | null; attribution: string | null }

export function audioUrl(id: string): string {
  return `/api/audio/${encodeURIComponent(id)}`
}

function cacheAvailable(): boolean {
  return typeof caches !== 'undefined'
}

export async function getCached(id: string): Promise<Response | undefined> {
  if (!cacheAvailable()) return undefined
  const cache = await caches.open(AUDIO_CACHE)
  return cache.match(audioUrl(id))
}

/** Downloads a clip and caches it when the answer is 200. Rejects when the server cannot be reached. */
export async function download(id: string): Promise<Response> {
  const response = await fetch(audioUrl(id), { credentials: 'same-origin' })
  if (response.status === 200 && cacheAvailable()) {
    const cache = await caches.open(AUDIO_CACHE)
    await cache.put(audioUrl(id), response.clone())
  }
  return response
}

/** The cached clip, or a fresh download when online; `undefined` when neither works. */
export async function cachedOrDownloaded(id: string): Promise<Response | undefined> {
  const cached = await getCached(id)
  if (cached) return cached
  if (!navigator.onLine) return undefined
  try {
    const response = await download(id)
    return response.ok ? response : undefined
  } catch {
    return undefined
  }
}

export async function isCached(id: string): Promise<boolean> {
  return (await getCached(id)) !== undefined
}

export async function clearAudioCache(): Promise<void> {
  if (cacheAvailable()) await caches.delete(AUDIO_CACHE)
}

/** Source and attribution from the clip's response headers (the attribution is percent-encoded UTF-8). */
export function audioDetails(response: Response): AudioDetails {
  const source = response.headers.get('x-audio-source')
  return {
    source: source === 'azure' || source === 'commons' ? source : null,
    attribution: decodeAttribution(response.headers.get('x-audio-attribution')),
  }
}

function decodeAttribution(header: string | null): string | null {
  if (!header) return null
  try {
    return decodeURIComponent(header)
  } catch {
    return header
  }
}

/** Number of cached clips and the distinct attributions of cached recordings (Settings → About). */
export async function cachedAudioInfo(): Promise<{ count: number; attributions: string[] }> {
  if (!cacheAvailable()) return { count: 0, attributions: [] }
  const cache = await caches.open(AUDIO_CACHE)
  const keys = await cache.keys()
  const attributions = new Set<string>()
  for (const request of keys) {
    const response = await cache.match(request)
    const attribution = response && audioDetails(response).attribution
    if (attribution) attributions.add(attribution)
  }
  return { count: keys.length, attributions: [...attributions].sort((a, b) => a.localeCompare(b)) }
}
