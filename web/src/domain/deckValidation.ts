import type { Directions } from './types'
import { checkText, type FieldError } from './validation'

export const DECK_NAME_MAX = 100

export type DeckInput = {
  name: string
  target_lang: string
  native_lang: string
  directions: Directions
  new_per_day: number | null
}

/** Trims the input and validates it (name required, ≤ 100 chars; languages required; new_per_day ≥ 0). */
export function validateDeckInput(input: DeckInput): { value: DeckInput; errors: FieldError[] } {
  const value: DeckInput = {
    ...input,
    name: input.name.trim(),
    target_lang: input.target_lang.trim(),
    native_lang: input.native_lang.trim(),
  }
  const errors = [
    ...checkText('name', value.name, { required: true, max: DECK_NAME_MAX }),
    ...checkText('target_lang', value.target_lang, { required: true, max: 35 }),
    ...checkText('native_lang', value.native_lang, { required: true, max: 35 }),
  ]
  if (value.new_per_day !== null && !(Number.isInteger(value.new_per_day) && value.new_per_day >= 0)) {
    errors.push({ field: 'new_per_day', code: 'invalid' })
  }
  return { value, errors }
}
