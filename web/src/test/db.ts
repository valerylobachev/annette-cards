import { forgetDeviceId } from '@/db/device'
import { db } from '@/db/schema'
import { setClock } from '@/lib/clock'

/** Gives each test an empty database, a fresh device id and the real clock. */
export async function resetDb() {
  db.close()
  await db.delete()
  await db.open()
  forgetDeviceId()
  setClock()
}
