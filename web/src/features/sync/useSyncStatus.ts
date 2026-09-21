import { useLiveQuery } from 'dexie-react-hooks'
import { useSyncExternalStore } from 'react'
import { getMeta } from '@/db/meta'
import { db } from '@/db/schema'
import { useOnline } from '@/lib/useOnline'
import { engineState, subscribeEngine } from './engine'

export type SyncState = 'synced' | 'syncing' | 'pending' | 'offline' | 'error' | 'signed_out'

export type SyncStatus = {
  state: SyncState
  pendingCount: number
  lastSyncAt: number | null
  /** Error code of the last run when it failed (`unauthorized` when the session expired). */
  lastError: string | null
}

/** The sync state for the indicator and S-15 (ui_ux.md §4). `undefined` while loading. */
export function useSyncStatus(): SyncStatus | undefined {
  const online = useOnline()
  const { running } = useSyncExternalStore(subscribeEngine, engineState)
  const stored = useLiveQuery(async () => ({
    signedIn: (await getMeta('account')) != null,
    sessionExpired: (await getMeta('session_expired')) === true,
    pendingCount: await db.outbox.count(),
    lastSyncAt: (await getMeta('last_sync_at')) ?? null,
    last: (await getMeta('sync_log'))?.[0] ?? null,
  }))
  if (!stored) return undefined

  const lastError = stored.sessionExpired
    ? 'unauthorized'
    : stored.last?.status === 'error'
      ? (stored.last.error_code ?? 'unknown')
      : null
  const state: SyncState = !stored.signedIn
    ? 'signed_out'
    : running
      ? 'syncing'
      : !online
        ? 'offline'
        : lastError
          ? 'error'
          : stored.pendingCount > 0
            ? 'pending'
            : 'synced'
  return { state, pendingCount: stored.pendingCount, lastSyncAt: stored.lastSyncAt, lastError }
}
