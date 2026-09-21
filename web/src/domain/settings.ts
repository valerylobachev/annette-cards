import type { Settings } from './types'

/** Defaults of the settings document: architecture.md §5.5 plus decision D3. */
export const DEFAULT_SETTINGS: Settings = {
  ui_language: 'ru',
  day_start_hour: 4,
  new_per_day: 15,
  max_reviews_per_day: 200,
  answer_mode: 'simple',
  desired_retention: 0.9,
  fsrs_weights: null,
  autoplay: 'front',
  reminder: { enabled: false, time: '20:00', tz: 'Europe/Riga' },
  default_directions: 'both',
  show_ipa_on_front: true,
}

/** Stored settings may be partial (older version, another device); missing fields fall back to defaults. */
export function mergeSettings(stored: Partial<Settings>): Settings {
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    reminder: { ...DEFAULT_SETTINGS.reminder, ...stored.reminder },
  }
}
