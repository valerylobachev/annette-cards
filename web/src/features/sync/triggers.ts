import { onLocalChange } from '@/db/changes'
import { syncNow } from './engine'

/** Local changes are pushed this long after the last one (architecture.md §4.3). */
export const CHANGE_DEBOUNCE_MS = 2_000

/**
 * Starts syncing on app start, when the app becomes visible, when the connection returns and 2 s after local
 * changes (the manual "Sync now" calls `syncNow` directly). The engine itself skips when signed out or offline.
 * Returns a function that stops the triggers.
 */
export function startSyncTriggers(): () => void {
  let debounce: ReturnType<typeof setTimeout> | undefined
  const onVisible = () => {
    if (document.visibilityState === 'visible') void syncNow('visible')
  }
  const onOnline = () => void syncNow('online')
  const stopChanges = onLocalChange(() => {
    clearTimeout(debounce)
    debounce = setTimeout(() => void syncNow('change'), CHANGE_DEBOUNCE_MS)
  })
  document.addEventListener('visibilitychange', onVisible)
  window.addEventListener('online', onOnline)
  void syncNow('start')
  return () => {
    clearTimeout(debounce)
    stopChanges()
    document.removeEventListener('visibilitychange', onVisible)
    window.removeEventListener('online', onOnline)
  }
}
