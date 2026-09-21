import { newId } from '@/lib/ids'
import { db } from './schema'

let cachedDeviceId: string | undefined

/** This device's id (`updated_by` of every local write). Created once and kept in `meta`. */
export async function getDeviceId(): Promise<string> {
  if (cachedDeviceId) return cachedDeviceId
  cachedDeviceId = await db.transaction('rw', db.meta, async () => {
    const row = await db.meta.get('device_id')
    if (typeof row?.value === 'string') return row.value
    const id = newId()
    await db.meta.put({ key: 'device_id', value: id })
    return id
  })
  return cachedDeviceId
}

/** Tests only: forget the cached id after the database was deleted. */
export function forgetDeviceId() {
  cachedDeviceId = undefined
}
