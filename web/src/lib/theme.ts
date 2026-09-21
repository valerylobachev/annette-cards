import type { MetaValues } from '@/db/meta'

export type Theme = MetaValues['theme']

/** Mirror of `meta.theme` read by `public/theme.js` before the first paint (IndexedDB is asynchronous). */
export const THEME_STORAGE_KEY = 'annette.theme'

/** Applies the theme as `data-theme` on `<html>` (the `dark` variant in index.css) and mirrors it for next start. */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement
  if (theme === 'system') root.removeAttribute('data-theme')
  else root.dataset.theme = theme
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme)
  } catch {
    // Private mode or storage disabled: the theme still applies once the app has loaded.
  }
}
