import { checkText, type FieldError } from './validation'

/** Field length limits (architecture.md §9). */
export const CARD_LIMITS = {
  front: 500,
  back: 500,
  example: 2000,
  example_translation: 2000,
  ipa: 200,
  notes: 2000,
  tag: 50,
} as const

/** Raw editor input: optional fields may be empty strings. */
export type CardDraft = {
  deck_id: string
  front: string
  back: string
  example?: string | null
  example_translation?: string | null
  ipa?: string | null
  tags?: string[]
  notes?: string | null
}

/** Clean card fields as stored. */
export type CardFields = {
  deck_id: string
  front: string
  back: string
  example: string | null
  example_translation: string | null
  ipa: string | null
  tags: string[]
  notes: string | null
}

function optional(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? ''
  return trimmed === '' ? null : trimmed
}

/** Trims tags, drops empty ones and duplicates (first spelling wins, compared case-insensitively). */
export function cleanTags(tags: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const tag of tags) {
    const trimmed = tag.trim().replace(/\s+/g, ' ')
    const key = trimmed.toLowerCase()
    if (trimmed === '' || seen.has(key)) continue
    seen.add(key)
    result.push(trimmed)
  }
  return result
}

/** Trims every field (empty optional fields become `null`) and checks required fields and length limits. */
export function validateCardInput(draft: CardDraft): { value: CardFields; errors: FieldError[] } {
  const value: CardFields = {
    deck_id: draft.deck_id,
    front: draft.front.trim(),
    back: draft.back.trim(),
    example: optional(draft.example),
    example_translation: optional(draft.example_translation),
    ipa: optional(draft.ipa),
    tags: cleanTags(draft.tags ?? []),
    notes: optional(draft.notes),
  }
  const errors: FieldError[] = [
    ...checkText('deck_id', value.deck_id, { required: true, max: 100 }),
    ...checkText('front', value.front, { required: true, max: CARD_LIMITS.front }),
    ...checkText('back', value.back, { required: true, max: CARD_LIMITS.back }),
    ...checkText('example', value.example, { max: CARD_LIMITS.example }),
    ...checkText('example_translation', value.example_translation, { max: CARD_LIMITS.example_translation }),
    ...checkText('ipa', value.ipa, { max: CARD_LIMITS.ipa }),
    ...checkText('notes', value.notes, { max: CARD_LIMITS.notes }),
    ...value.tags.flatMap((tag) => checkText('tags', tag, { max: CARD_LIMITS.tag })),
  ]
  return { value, errors }
}
