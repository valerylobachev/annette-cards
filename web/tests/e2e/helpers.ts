import type { Page } from '@playwright/test'

type Row = Record<string, unknown>

/**
 * Starts the app in the given UI language (default English) regardless of the browser locale, as the installed
 * Home Screen app: the WebKit project emulates iPhone Safari, where the one-time install hint would cover every
 * screen. Pass `installed: false` to test the hint.
 */
export async function setUpApp(page: Page, language: 'en' | 'ru' = 'en', { installed = true } = {}) {
  await page.addInitScript(
    ({ lang, standalone }) => {
      if (!localStorage.getItem('annette.uiLanguage')) localStorage.setItem('annette.uiLanguage', lang)
      if (standalone) Object.defineProperty(navigator, 'standalone', { value: true, configurable: true })
    },
    { lang: language, standalone: installed },
  )
}

/**
 * Writes rows straight into the app's IndexedDB (created by Dexie on first load) to seed a test quickly.
 * The page must already have opened the app once.
 */
export async function seed(page: Page, tables: Record<string, Row[]>) {
  await page.evaluate(async (data) => {
    const names = Object.keys(data)
    const open = () =>
      new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('annette')
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
    // Wait until Dexie has created the schema.
    let db = await open()
    for (let attempt = 0; names.some((name) => !db.objectStoreNames.contains(name)); attempt++) {
      db.close()
      if (attempt > 100) throw new Error('app database was not created')
      await new Promise((resolve) => setTimeout(resolve, 50))
      db = await open()
    }
    const tx = db.transaction(names, 'readwrite')
    for (const name of names) for (const row of data[name] ?? []) tx.objectStore(name).put(row)
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  }, tables)
}

const stamp = { updated_at: 1, updated_by: 'e2e', deleted_at: null }

export function deckRow(id: string, name: string, extra: Row = {}): Row {
  return {
    id,
    name,
    target_lang: 'en-GB',
    native_lang: 'ru',
    directions: 'both',
    new_per_day: null,
    archived_at: null,
    created_at: 1,
    ...stamp,
    ...extra,
  }
}

export function cardRow(id: string, deck_id: string, front: string, back: string, extra: Row = {}): Row {
  return {
    id,
    deck_id,
    front,
    back,
    example: null,
    example_translation: null,
    ipa: null,
    tags: [],
    notes: null,
    audio_id: null,
    created_at: 1,
    ...stamp,
    ...extra,
  }
}

/** A New study state for one direction of a card (seeded rows skip the repository that creates them). */
export function newStateRow(card_id: string, direction: 'forward' | 'reverse' = 'forward', extra: Row = {}): Row {
  return {
    card_id,
    direction,
    state: 0,
    due: 1,
    stability: 0,
    difficulty: 0,
    elapsed_days: 0,
    scheduled_days: 0,
    learning_steps: 0,
    reps: 0,
    lapses: 0,
    last_review: null,
    ...stamp,
    ...extra,
  }
}

/** Reads one row of the app's IndexedDB (for waiting until a write has been committed). */
export async function readRow(page: Page, store: string, key: string): Promise<Row | undefined> {
  const row: unknown = await page.evaluate(
    ({ store, key }) =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open('annette')
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          const get = request.result.transaction(store).objectStore(store).get(key)
          get.onsuccess = () => {
            request.result.close()
            resolve(get.result)
          }
          get.onerror = () => reject(get.error)
        }
      }),
    { store, key },
  )
  return row as Row | undefined
}
