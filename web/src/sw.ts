/**
 * The service worker (architecture.md §4.7), built by vite-plugin-pwa (`injectManifest`): the app-shell precache,
 * audio caching and the study reminder (UC-23). Relative imports only: this file is bundled on its own. Type-checked
 * with the WebWorker library by tsconfig.sw.json.
 */
import { CacheableResponsePlugin } from 'workbox-cacheable-response'
import { ExpirationPlugin } from 'workbox-expiration'
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  type PrecacheEntry,
  precacheAndRoute,
} from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { CacheFirst } from 'workbox-strategies'
import { DB_NAME } from './db/dbName'
import { parseReminderPayload, reminderNotification } from './domain/reminder'
import { notifications as en } from './i18n/en.json'
import { notifications as ru } from './i18n/ru.json'

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: (string | PrecacheEntry)[] }

precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()
// Every route opens offline; `/api` is left to the network.
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html'), { denylist: [/^\/api\//] }))

// Clips never change (a new clip gets a new id); the app also writes this cache (src/lib/audio/audioCache.ts).
registerRoute(
  ({ url }) => url.pathname.startsWith('/api/audio/'),
  new CacheFirst({
    cacheName: 'audio-v1',
    plugins: [new ExpirationPlugin({ maxEntries: 5000 }), new CacheableResponsePlugin({ statuses: [200] })],
  }),
)

// `registerType: 'prompt'`: the update banner asks the waiting worker to take over.
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') void self.skipWaiting()
})

self.addEventListener('push', (event) => {
  let data: unknown = null
  try {
    data = event.data?.json()
  } catch {
    // Not JSON: not ours.
  }
  const reminder = parseReminderPayload(data)
  if (!reminder) return
  event.waitUntil(
    uiLanguage().then((language) => {
      const { title, body } = reminderNotification(
        reminder.due,
        language,
        language === 'ru' ? ru.reminder : en.reminder,
      )
      return self.registration.showNotification(title, {
        body,
        icon: '/pwa-192x192.png',
        // A new reminder replaces yesterday's unread one.
        tag: 'reminder',
        data: { url: '/' },
      })
    }),
  )
})

/** Tapping the notification opens Today: in an open window of the app when there is one. */
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (windows) => {
      const open = windows[0]
      if (!open) {
        await self.clients.openWindow('/')
        return
      }
      open.postMessage({ type: 'open-today' })
      await open.focus()
    }),
  )
})

/** `ui_language` of the settings document on this device, else the device language (like the app, §4.6). */
async function uiLanguage(): Promise<'en' | 'ru'> {
  const stored = await storedUiLanguage()
  return (stored ?? self.navigator.language).toLowerCase().startsWith('ru') ? 'ru' : 'en'
}

/** Reads the settings row with plain IndexedDB (no Dexie in the worker); never creates the database. */
function storedUiLanguage(): Promise<string | undefined> {
  return new Promise((resolve) => {
    const open = indexedDB.open(DB_NAME)
    open.onupgradeneeded = () => open.transaction?.abort()
    open.onerror = () => resolve(undefined)
    open.onsuccess = () => {
      const database = open.result
      try {
        const request = database.transaction('settings').objectStore('settings').get('user')
        request.onsuccess = () => resolve(request.result?.ui_language)
        request.onerror = () => resolve(undefined)
      } catch {
        resolve(undefined)
      } finally {
        database.close()
      }
    }
  })
}
