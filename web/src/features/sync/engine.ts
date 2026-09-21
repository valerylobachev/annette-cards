import { deleteCardsOfDeletedDecks } from '@/db/decks'
import { deleteMeta, getMeta, type SyncLogEntry, setMeta } from '@/db/meta'
import { db } from '@/db/schema'
import { apiErrorCode, isUnauthorized } from '@/lib/api'
import { now } from '@/lib/clock'
import { getAccount, markSessionExpired } from '../auth/account'
import { pullAll } from './pull'
import { pushOutbox } from './push'

export type SyncReason = 'start' | 'visible' | 'online' | 'change' | 'manual' | 'retry' | 'signin'

/** Runs kept in `meta.sync_log`. */
export const SYNC_LOG_SIZE = 10
/** A device clock further than this from the server's is reported in S-15 (UC-20). */
export const CLOCK_SKEW_LIMIT_MS = 5 * 60 * 1000
/** Push rounds per sync: edits made while syncing are sent in the next round. */
const MAX_PUSH_ROUNDS = 5
const RETRY_BASE_MS = 5_000
const RETRY_MAX_MS = 5 * 60 * 1000

type EngineState = { running: boolean }

let state: EngineState = { running: false }
const listeners = new Set<() => void>()
let current: Promise<void> | null = null
let runAgain = false
let failures = 0
let retryTimer: ReturnType<typeof setTimeout> | undefined

function setState(next: EngineState) {
  state = next
  for (const listener of listeners) listener()
}

/** For `useSyncExternalStore`. */
export function subscribeEngine(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function engineState(): EngineState {
  return state
}

/** Whether this device may sync now: signed in, session valid, online. */
async function canSync(): Promise<boolean> {
  if (!navigator.onLine || !(await getAccount())) return false
  return (await getMeta('session_expired')) !== true
}

/**
 * Pushes the outbox and pulls the server's changes (architecture.md §6.2). Single-flight: a call while a sync runs
 * schedules exactly one more run after it, so a change made during a sync is not left behind. Resolves when the
 * work is done; errors are logged, never thrown.
 */
export function syncNow(reason: SyncReason): Promise<void> {
  if (current) {
    runAgain = true
    return current
  }
  current = (async () => {
    try {
      do {
        runAgain = false
        await runOnce(reason)
      } while (runAgain)
    } catch (error) {
      // Only local failures get here (the database closed, storage full); the next trigger tries again.
      console.error('sync failed', error)
    } finally {
      current = null
    }
  })()
  return current
}

async function runOnce(reason: SyncReason): Promise<void> {
  if (!(await canSync())) return
  clearTimeout(retryTimer)
  setState({ running: true })
  const started_at = now()
  let pushed = 0
  let pulled = 0
  const rejected: SyncLogEntry['rejected'] = []
  try {
    for (let round = 0; round < MAX_PUSH_ROUNDS; round++) {
      const result = await pushOutbox()
      pushed += result.pushed
      rejected.push(...result.rejected)
      if (round === 0 && result.serverTime !== null) await recordClockSkew(result.serverTime)
      if ((await db.outbox.count()) === 0) break
    }
    pulled = await pullAll()
    // Cards left in decks deleted elsewhere are deleted now; they are pushed on the next (debounced) sync.
    await deleteCardsOfDeletedDecks()
    const finished_at = now()
    await setMeta('last_sync_at', finished_at)
    await appendLog({ started_at, finished_at, status: 'ok', pushed, pulled, rejected })
    failures = 0
  } catch (error) {
    const error_code = apiErrorCode(error)
    await appendLog({ started_at, finished_at: now(), status: 'error', pushed, pulled, rejected, error_code })
    if (isUnauthorized(error)) await markSessionExpired()
    else scheduleRetry()
    if (import.meta.env.DEV) console.warn(`sync (${reason}) failed: ${error_code}`)
  } finally {
    setState({ running: false })
  }
}

/** After a failed sync, try again in 5 s, 10 s, 20 s … up to 5 min (triggers such as `online` may come first). */
function scheduleRetry() {
  failures += 1
  const delay = Math.min(RETRY_BASE_MS * 2 ** (failures - 1), RETRY_MAX_MS)
  clearTimeout(retryTimer)
  retryTimer = setTimeout(() => void syncNow('retry'), delay)
}

async function recordClockSkew(serverTime: number) {
  const skew = Date.now() - serverTime
  if (Math.abs(skew) > CLOCK_SKEW_LIMIT_MS) await setMeta('clock_skew_ms', skew)
  else await deleteMeta('clock_skew_ms')
}

async function appendLog(entry: SyncLogEntry) {
  const log = (await getMeta('sync_log')) ?? []
  await setMeta('sync_log', [entry, ...log].slice(0, SYNC_LOG_SIZE))
}

/** Tests only: forget retries and failures between tests. */
export function resetEngine() {
  clearTimeout(retryTimer)
  failures = 0
  runAgain = false
  current = null
  state = { running: false }
}
