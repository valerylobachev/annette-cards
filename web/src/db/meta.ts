import { db } from './schema'

/** Signed-in account shown in Settings (Phase 2). */
export type AccountInfo = { user_id: string; email: string; display_name: string; is_admin: boolean }

/**
 * Device-local values (architecture.md §4.2). They are never synced, so writing them never creates an outbox
 * entry: voices differ between devices, and the sync cursor belongs to this device.
 */
export type MetaValues = {
  device_id: string
  sync_cursor: number
  last_sync_at: number
  account: AccountInfo | null
  /** Selected voice URI per BCP-47 language. */
  voice_pref: Record<string, string>
  speech_rate: number
  theme: 'system' | 'light' | 'dark'
  audio_prefetch: boolean
}

export type MetaKey = keyof MetaValues

export async function getMeta<K extends MetaKey>(key: K): Promise<MetaValues[K] | undefined> {
  const row = await db.meta.get(key)
  return row?.value as MetaValues[K] | undefined
}

export async function setMeta<K extends MetaKey>(key: K, value: MetaValues[K]): Promise<void> {
  await db.meta.put({ key, value })
}
