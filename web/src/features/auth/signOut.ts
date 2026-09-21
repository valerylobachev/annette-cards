import { logout } from '@/api/endpoints/auth/auth'
import { wipeLocalData } from '@/db/localData'
import { db } from '@/db/schema'
import { callApi } from '@/lib/api'
import { syncNow, waitForIdle } from '../sync/engine'
import { clearAccount } from './account'

/**
 * Before signing out: when there are unsynced changes and a connection, tries one sync. Returns how many changes
 * are still unsynced (they would be lost: UC-03 asks before signing out).
 */
export async function unsyncedBeforeSignOut(): Promise<number> {
  if ((await db.outbox.count()) > 0 && navigator.onLine) await syncNow('manual')
  return db.outbox.count()
}

/**
 * Signs out (UC-03): stops syncing, revokes the session on the server (ignored when offline), removes the account's
 * data from this device (`wipeLocalData`) and the cached files except the app itself (the service worker's precache
 * stays, so the app still opens offline).
 */
export async function signOut(): Promise<void> {
  await clearAccount()
  await waitForIdle()
  try {
    await callApi(() => logout())
  } catch {
    // Offline or the session already ended.
  }
  await wipeLocalData()
  await clearCaches()
}

async function clearCaches() {
  if (!('caches' in window)) return
  for (const key of await caches.keys()) {
    if (!key.startsWith('workbox-precache')) await caches.delete(key)
  }
}
