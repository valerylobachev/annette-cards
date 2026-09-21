import type { Page } from '@playwright/test'

type Row = Record<string, unknown>

/** Starts the app in the given UI language (default English) regardless of the browser locale. */
export async function useUiLanguage(page: Page, language: 'en' | 'ru' = 'en') {
  await page.addInitScript((lang) => {
    if (!localStorage.getItem('annette.uiLanguage')) localStorage.setItem('annette.uiLanguage', lang)
  }, language)
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
