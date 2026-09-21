export const studyModes = ['swipe', 'choice', 'listening', 'typing'] as const
export type StudyMode = (typeof studyModes)[number]

/** `/study?deck=<id>&mode=swipe` (ui_ux.md §3 deep links). */
export type StudySearch = { deck?: string; mode?: StudyMode }

/** `/signin?invite=<code>` and `/register?invite=<code>` (S-02). */
export type AuthSearch = { invite?: string }

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

export function parseStudySearch(search: Record<string, unknown>): StudySearch {
  const mode = studyModes.find((m) => m === search.mode)
  return { deck: optionalString(search.deck), mode }
}

export function parseAuthSearch(search: Record<string, unknown>): AuthSearch {
  return { invite: optionalString(search.invite) }
}
