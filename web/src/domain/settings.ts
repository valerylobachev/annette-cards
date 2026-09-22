import { validWeights } from './fsrs'
import type { Settings } from './types'
import type { FieldError } from './validation'

/** Defaults of the settings document: architecture.md §5.5 plus decision D3. */
export const DEFAULT_SETTINGS: Settings = {
  ui_language: 'ru',
  day_start_hour: 4,
  new_per_day: 15,
  max_reviews_per_day: 200,
  answer_mode: 'simple',
  desired_retention: 0.9,
  fsrs_weights: null,
  fsrs_optimized_at: null,
  autoplay: 'front',
  reminder: { enabled: false, time: '20:00', tz: 'Europe/Riga' },
  default_directions: 'both',
  show_ipa_on_front: true,
  listening_answer: 'choose',
}

/** Stored settings may be partial (older version, another device); missing fields fall back to defaults. */
export function mergeSettings(stored: Partial<Settings>): Settings {
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    reminder: { ...DEFAULT_SETTINGS.reminder, ...stored.reminder },
  }
}

/** Allowed ranges of the numeric settings (S-14). */
export const SETTINGS_LIMITS = {
  new_per_day: { min: 1, max: 200 },
  max_reviews_per_day: { min: 10, max: 1000 },
  day_start_hour: { min: 0, max: 23 },
  desired_retention: { min: 0.8, max: 0.95 },
} as const

type LimitedField = keyof typeof SETTINGS_LIMITS
const INTEGER_FIELDS: LimitedField[] = ['new_per_day', 'max_reviews_per_day', 'day_start_hour']

/**
 * Errors of a settings change: numbers outside their range (`SETTINGS_LIMITS`) or not whole where required, and
 * FSRS weights that are not 21 finite numbers.
 */
export function validateSettingsPatch(patch: Partial<Settings>): FieldError[] {
  const errors: FieldError[] = []
  if (patch.fsrs_weights && !validWeights(patch.fsrs_weights)) errors.push({ field: 'fsrs_weights', code: 'invalid' })
  for (const field of Object.keys(SETTINGS_LIMITS) as LimitedField[]) {
    const value = patch[field]
    if (value === undefined) continue
    const { min, max } = SETTINGS_LIMITS[field]
    // A small tolerance keeps 0.95 from a float slider valid.
    const inRange = value >= min - 1e-9 && value <= max + 1e-9
    if (!inRange || (INTEGER_FIELDS.includes(field) && !Number.isInteger(value))) {
      errors.push({ field, code: 'invalid' })
    }
  }
  return errors
}
