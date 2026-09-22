import { unsubscribe as deleteSubscription, subscribe as postSubscription } from '@/api/endpoints/push/push'
import { meta } from '@/api/endpoints/system/system'
import { getSettings, updateSettings } from '@/db/settings'
import { deviceTimeZone } from '@/domain/studyDay'
import { ApiError, callApi } from '@/lib/api'

/**
 * Daily study reminders on this device (UC-23): the browser's push subscription is stored on the server, and the
 * `reminder` field of the settings document (synced) tells the server when to send. The time is an account setting;
 * every device that turned reminders on gets them.
 */

export type EnableResult = 'enabled' | 'denied' | 'unsupported'

export function pushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

/** This browser's push subscription, if any. Never waits for a service worker that is not there (dev server). */
export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null
  const registration = await navigator.serviceWorker.getRegistration()
  return (await registration?.pushManager.getSubscription()) ?? null
}

/**
 * Turns reminders on at `time` (`HH:MM`, this device's time zone). Call it straight from the tap: iOS shows the
 * permission prompt only during a user gesture, so asking is the first thing it does. Throws `ApiError` when the
 * server cannot store the subscription.
 */
export async function enableReminders(time: string): Promise<EnableResult> {
  if (!pushSupported()) return 'unsupported'
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return 'denied'
  const registration = await navigator.serviceWorker.getRegistration()
  if (!registration) return 'unsupported'
  const { vapid_public_key } = await callApi(() => meta())
  if (!vapid_public_key) throw new ApiError(409, 'push_disabled')

  const key = base64UrlToBytes(vapid_public_key)
  let subscription = await registration.pushManager.getSubscription()
  if (subscription && !sameKey(subscription.options.applicationServerKey, key)) {
    // The server's keys changed: a subscription is bound to the key it was made with.
    await subscription.unsubscribe()
    subscription = null
  }
  subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
  const { endpoint, keys } = subscription.toJSON()
  if (!endpoint || !keys?.p256dh || !keys.auth) throw new ApiError(0, 'unknown')
  await callApi(() => postSubscription({ endpoint, keys: { p256dh: keys.p256dh ?? '', auth: keys.auth ?? '' } }))
  await updateSettings({ reminder: { enabled: true, time, tz: deviceTimeZone() } })
  return 'enabled'
}

/** Turns reminders off for the account and removes this device's subscription. */
export async function disableReminders(): Promise<void> {
  await removeSubscription()
  const { reminder } = await getSettings()
  await updateSettings({ reminder: { ...reminder, enabled: false } })
}

/** A new reminder time, in this device's current time zone. */
export async function changeReminderTime(time: string): Promise<void> {
  const { reminder } = await getSettings()
  await updateSettings({ reminder: { ...reminder, time, tz: deviceTimeZone() } })
}

/**
 * Removes this device's subscription from the server and the browser (turning reminders off, signing out). The
 * server call may fail (offline): the push service then answers 410 to the next reminder and the server deletes it.
 */
export async function removeSubscription(): Promise<void> {
  const subscription = await currentSubscription()
  if (!subscription) return
  try {
    await callApi(() => deleteSubscription({ endpoint: subscription.endpoint }))
  } catch {
    // Offline, already removed (404) or push turned off on the server.
  }
  await subscription.unsubscribe()
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/')
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='))
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

function sameKey(current: ArrayBuffer | null, key: Uint8Array): boolean {
  if (!current) return false
  const bytes = new Uint8Array(current)
  return bytes.length === key.length && bytes.every((byte, i) => byte === key[i])
}
