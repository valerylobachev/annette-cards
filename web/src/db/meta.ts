import type { StudySessionSnapshot } from '@/domain/studySession'
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
  /** Deck preselected in Quick add. */
  last_quick_add_deck: string
  /** "Learn extra new words": extra new cards allowed on one study day (`YYYY-MM-DD`). */
  extra_new: { study_day: string; count: number }
  /** The current or last study session, resumed within 30 min (S-11). */
  study_session: StudySessionSnapshot
  /** The one-time iOS install hint was shown and closed. */
  install_hint_shown: boolean
  /** Answer of `navigator.storage.persist()`: `false` shows the data-loss warning. */
  storage_persisted: boolean
  /** First-run onboarding (S-01) was finished on this device. */
  onboarding_done: boolean
}

export type MetaKey = keyof MetaValues

export async function getMeta<K extends MetaKey>(key: K): Promise<MetaValues[K] | undefined> {
  const row = await db.meta.get(key)
  return row?.value as MetaValues[K] | undefined
}

export async function setMeta<K extends MetaKey>(key: K, value: MetaValues[K]): Promise<void> {
  await db.meta.put({ key, value })
}

export async function deleteMeta(key: MetaKey): Promise<void> {
  await db.meta.delete(key)
}
