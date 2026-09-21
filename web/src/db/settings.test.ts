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

  it('update stamps the row and adds an outbox entry', async () => {
    const settings = await updateSettings({ answer_mode: 'detailed' })
    expect(settings.answer_mode).toBe('detailed')
    expect(await db.settings.get('user')).toMatchObject({ updated_by: await getDeviceId() })
    expect(await db.outbox.toArray()).toEqual([{ seq: expect.any(Number), entity: 'settings', entity_id: 'user' }])
  })
})
