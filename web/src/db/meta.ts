import type { StudySessionSnapshot } from '@/domain/studySession'
import { db } from './schema'

/** One sync run (S-15 sync log). */
export type SyncLogEntry = {
  started_at: number
  finished_at: number
  status: 'ok' | 'error'
  pushed: number
  pulled: number
  /** Rows the server refused; they are not retried. */
  rejected: { entity: string; id: string; code: string }[]
  /** Error code of a failed run (`network`, `unauthorized`, …). */
  error_code?: string
}

/** The signed-in account (S-15), stored on this device only. */
export type AccountInfo = { user_id: string; email: string; display_name: string; is_admin: boolean }

/**
 * Device-local values (architecture.md §4.2). They are never synced, so writing them never creates an outbox
 * entry: voices differ between devices, and the sync cursor belongs to this device.
 */
export type MetaValues = {
  device_id: string
  /** `server_seq` of the last pulled row. */
  sync_cursor: number
  /** End of the last successful sync. */
  last_sync_at: number
  /** The last 10 sync runs, newest first (S-15). */
  sync_log: SyncLogEntry[]
  /** Device clock minus server clock, stored while it exceeds 5 minutes (S-15 warning). */
  clock_skew_ms: number
  account: AccountInfo | null
  /** Signed in, but the first-sync choice (S-03) is still open: the account is stored once it is made. */
  pending_account: AccountInfo
  /** The server answered 401 for the stored account: "Sign in again" is shown; local data is kept. */
  session_expired: boolean
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
