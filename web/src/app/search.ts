export const studyModes = ['swipe', 'choice', 'listening', 'typing'] as const
export type StudyMode = (typeof studyModes)[number]

/**
 * `/study?deck=<id>&mode=swipe&practice=1` (ui_ux.md §3 deep links; `practice` = UC-16 practice mode).
 * `repeat=<session id>` ("Repeat these now", S-12) practices the cards failed in that session; it implies practice.
 */
export type StudySearch = { deck?: string; mode?: StudyMode; practice?: 1; repeat?: string }

/** `/study/summary?session=<id>` (S-12): the finished session (`meta.study_session`). */
export type SummarySearch = { session?: string }

/** `/import?deck=<id>` (S-10): import into an existing deck. */
export type ImportSearch = { deck?: string }

/** `/cards/new?deck=<id>` (S-08): the deck to add the card to. */
export type CardNewSearch = { deck?: string }

/** `/signin?invite=<code>` and `/register?invite=<code>` (S-02). */
export type AuthSearch = { invite?: string }

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

export function parseStudySearch(search: Record<string, unknown>): StudySearch {
  const mode = studyModes.find((m) => m === search.mode)
  const repeat = optionalString(search.repeat)
  const practice = search.practice === 1 || search.practice === '1' || repeat ? 1 : undefined
  return { deck: optionalString(search.deck), mode, practice, repeat }
}

export function parseAuthSearch(search: Record<string, unknown>): AuthSearch {
  return { invite: optionalString(search.invite) }
}

export function parseCardNewSearch(search: Record<string, unknown>): CardNewSearch {
  return { deck: optionalString(search.deck) }
}

export function parseImportSearch(search: Record<string, unknown>): ImportSearch {
  return { deck: optionalString(search.deck) }
}

export function parseSummarySearch(search: Record<string, unknown>): SummarySearch {
  return { session: optionalString(search.session) }
}
