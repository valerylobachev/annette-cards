import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '@/domain/settings'
import { resetDb } from '@/test/db'
import { getDeviceId } from './device'
import { db } from './schema'
import { getSettings, updateSettings } from './settings'

beforeEach(resetDb)

describe('settings repository', () => {
  it('returns the defaults on an empty database', async () => {
    const settings = await getSettings()
    expect(settings).toEqual(DEFAULT_SETTINGS)
    expect(settings).toMatchObject({
      new_per_day: 15,
      day_start_hour: 4,
      default_directions: 'both',
      show_ipa_on_front: true,
    })
  })

  it('merges a partial stored row with the defaults', async () => {
    await db.settings.put({
      id: 'user',
      new_per_day: 25,
      reminder: { enabled: true, time: '09:00', tz: 'Europe/Warsaw' },
      updated_at: 1,
      updated_by: 'other-device',
    })
    expect(await getSettings()).toEqual({
      ...DEFAULT_SETTINGS,
      new_per_day: 25,
      reminder: { enabled: true, time: '09:00', tz: 'Europe/Warsaw' },
    })
  })

  it('stores only the fields that were set', async () => {
    await updateSettings({ new_per_day: 20 })
    const row = await db.settings.get('user')
    expect(row).toMatchObject({ id: 'user', new_per_day: 20 })
    expect(row).not.toHaveProperty('ui_language')
    expect((await getSettings()).ui_language).toBe(DEFAULT_SETTINGS.ui_language)
  })

  it('changing new_per_day stamps the document and adds one outbox entry', async () => {
    await updateSettings({ new_per_day: 30 })
    await updateSettings({ new_per_day: 31 })
    expect(await db.settings.get('user')).toMatchObject({ new_per_day: 31, updated_by: await getDeviceId() })
    expect(await db.outbox.where('entity').equals('settings').count()).toBe(1)
  })

  it('rejects values out of range without writing', async () => {
    await expect(updateSettings({ desired_retention: 0.99 })).rejects.toThrow('desired_retention invalid')
    expect(await db.settings.count()).toBe(0)
  })

  it('update stamps the row and adds an outbox entry', async () => {
    const settings = await updateSettings({ answer_mode: 'detailed' })
    expect(settings.answer_mode).toBe('detailed')
    expect(await db.settings.get('user')).toMatchObject({ updated_by: await getDeviceId() })
    expect(await db.outbox.toArray()).toEqual([{ seq: expect.any(Number), entity: 'settings', entity_id: 'user' }])
  })
})
