/**
 * AI suggestions against the card fields the learner already has (ui_ux.md S-08, UC-09): an empty field may be
 * filled directly; a filled field with a different value is a conflict that needs confirmation (never overwritten
 * silently); an identical value needs nothing.
 */

export const SUGGESTION_FIELDS = ['back', 'example', 'example_translation', 'ipa', 'notes'] as const
export type SuggestionField = (typeof SUGGESTION_FIELDS)[number]

/** Suggested values (`POST /api/enrich`); `null` or a missing field means no suggestion for it. */
export type Suggestion = { [F in SuggestionField]?: string | null }

/** Current editor values of the fields that can be suggested ('' = empty). */
export type SuggestibleFields = Record<SuggestionField, string>

export type SuggestionStatus = 'empty-fill' | 'conflict' | 'same'

export type MergedSuggestion = { value: string; suggestion: string; status: SuggestionStatus }

/** Each field with a suggestion, compared with its current value (whitespace around values is ignored). */
export function mergeSuggestions(
  current: SuggestibleFields,
  suggestion: Suggestion,
): Partial<Record<SuggestionField, MergedSuggestion>> {
  const merged: Partial<Record<SuggestionField, MergedSuggestion>> = {}
  for (const field of SUGGESTION_FIELDS) {
    const suggested = suggestion[field]?.trim()
    if (!suggested) continue
    const value = current[field]
    const status: SuggestionStatus =
      value.trim() === '' ? 'empty-fill' : value.trim() === suggested ? 'same' : 'conflict'
    merged[field] = { value, suggestion: suggested, status }
  }
  return merged
}

/**
 * "Accept all": empty fields take their suggestion at once; conflicting fields are left unchanged and returned in
 * `conflicts`, to be replaced only after the learner confirms.
 */
export function acceptAll(
  current: SuggestibleFields,
  merged: Partial<Record<SuggestionField, MergedSuggestion>>,
): { fields: SuggestibleFields; conflicts: SuggestionField[] } {
  const fields = { ...current }
  const conflicts: SuggestionField[] = []
  for (const field of SUGGESTION_FIELDS) {
    const entry = merged[field]
    if (entry?.status === 'empty-fill') fields[field] = entry.suggestion
    if (entry?.status === 'conflict') conflicts.push(field)
  }
  return { fields, conflicts }
}
