import { setMeta } from '@/db/meta'

/**
 * Asks the browser to keep IndexedDB when space runs low (architecture.md §4.7); Safari may otherwise evict the
 * data of sites that are not installed. The answer is kept in `meta.storage_persisted`; `null` when the API is
 * missing.
 */
export async function requestPersistence(): Promise<boolean | null> {
  if (!navigator.storage?.persist) return null
  const persisted = (await navigator.storage.persisted?.()) || (await navigator.storage.persist())
  await setMeta('storage_persisted', persisted)
  return persisted
}
