import { mergeSettings, validateSettingsPatch } from '@/domain/settings'
import type { Settings } from '@/domain/types'
import { ValidationError } from '@/domain/validation'
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

/** The fields of the settings document that were set, without defaults (what a backup carries). */
export async function getStoredSettings(): Promise<Partial<Settings>> {
  const row = await db.settings.get(SETTINGS_ID)
  if (!row) return {}
  const { id: _id, updated_at: _at, updated_by: _by, ...stored } = row
  return stored
}

/** The settings document (single row `user`) merged over the defaults. */
export async function getSettings(): Promise<Settings> {
  return toSettings(await db.settings.get(SETTINGS_ID))
}

/**
 * Validates `patch`, merges it into the stored document, stamps it and records it in the outbox. Only fields that
 * were set are stored (defaults are merged on read), so an untouched `ui_language` never overrides the language
 * detected on a device.
 */
export function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  const errors = validateSettingsPatch(patch)
  if (errors.length > 0) return Promise.reject(new ValidationError(errors))
  return mutate(['settings'], async (ctx) => {
    const stored = await ctx.db.settings.get(SETTINGS_ID)
    const row: SettingsRow = stamp(ctx, { ...stored, ...patch, id: SETTINGS_ID })
    await ctx.db.settings.put(row)
    await addToOutbox(ctx, 'settings', SETTINGS_ID)
    return toSettings(row)
  })
}
