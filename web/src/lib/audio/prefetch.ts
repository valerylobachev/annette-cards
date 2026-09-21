import { audioIdsOfActiveDecks } from '@/db/cards'
import { getMeta } from '@/db/meta'
import { download, isCached } from './audioCache'

/** Clips downloaded at the same time. */
const CONCURRENCY = 2

/** Clips of active decks that are not cached yet. */
export async function audioIdsToPrefetch(): Promise<string[]> {
  const ids = await audioIdsOfActiveDecks()
  const missing: string[] = []
  for (const id of ids) if (!(await isCached(id))) missing.push(id)
  return missing
}

let running = false

/**
 * Downloads the missing clips of active decks (`meta.audio_prefetch`, after a sync), two at a time; stops when the
 * connection is lost. Returns how many were cached.
 */
export async function prefetchAudio(): Promise<number> {
  if (running || (await getMeta('audio_prefetch')) !== true) return 0
  running = true
  try {
    const queue = await audioIdsToPrefetch()
    let cached = 0
    const worker = async () => {
      for (let id = queue.shift(); id !== undefined && navigator.onLine; id = queue.shift()) {
        try {
          if ((await download(id)).ok) cached += 1
        } catch {
          return // offline or the server is gone: try again after the next sync
        }
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker))
    return cached
  } finally {
    running = false
  }
}
