import { forgetDeviceId } from '@/db/device'
import { db } from '@/db/schema'
import { resetStampTime } from '@/db/write'
import { resetEngine } from '@/features/sync/engine'
import { setClock } from '@/lib/clock'

/** Gives each test an empty database, a fresh device id, the real clock and an idle sync engine. */
export async function resetDb() {
  db.close()
  await db.delete()
  await db.open()
  forgetDeviceId()
  setClock()
  resetStampTime()
  resetEngine()
}
