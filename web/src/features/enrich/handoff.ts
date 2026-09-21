import type { Suggestion } from '@/domain/enrich'

/** Quick add → "Edit" opens the card editor with the word and its suggestions as ghosts (S-09 → S-08). */
export type EnrichHandoff = { front: string; suggestion: Suggestion }

declare module '@tanstack/react-router' {
  interface HistoryState {
    enrich?: EnrichHandoff
  }
}
