import { beforeEach, describe, expect, it } from 'vitest'
import { resetDb } from '@/test/db'
import { getDeviceId } from './device'
import { getMeta } from './meta'

beforeEach(resetDb)

describe('getDeviceId', () => {
  it('creates the id once and returns the same id afterwards', async () => {
    const first = await getDeviceId()
    expect(await getDeviceId()).toBe(first)
    expect(await getMeta('device_id')).toBe(first)
  })

  it('creates a new id for a fresh database', async () => {
    const first = await getDeviceId()
    await resetDb()
    expect(await getDeviceId()).not.toBe(first)
  })
})
