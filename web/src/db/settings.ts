import { mergeSettings } from '@/domain/settings'
import type { Settings } from '@/domain/types'
import { addToOutbox } from './outbox'
import { db, type SettingsRow } from './schema'
import { mutate, stamp } from './write'

const SETTINGS_ID = 'user'

/** Strips the row fields and merges the stored document over the defaults. */
export function toSettings(row: SettingsRow | undefined): Settings {
  if (!row) return mergeSettings({})
  const { id: _id, updated_at: _at, updated_by: _by, ...stored } = row
  return mergeSettings(stored)
}

/** The settings document (single row `user`) merged over the defaults. */
export async function getSettings(): Promise<Settings> {
  return toSettings(await db.settings.get(SETTINGS_ID))
}

/** Merges `patch` into the stored document, stamps it and records it in the outbox. */
export function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  return mutate(['settings'], async (ctx) => {
    const current = toSettings(await ctx.db.settings.get(SETTINGS_ID))
    const row: SettingsRow = stamp(ctx, { ...current, ...patch, id: SETTINGS_ID })
    await ctx.db.settings.put(row)
    await addToOutbox(ctx, 'settings', SETTINGS_ID)
    return toSettings(row)
  })
}
