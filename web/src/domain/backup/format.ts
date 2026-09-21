import type { Card, CardState, Deck, ReviewLog, Settings } from '../types'

export const BACKUP_FORMAT = 'annette-cards-backup'
export const BACKUP_VERSION = 1

/**
 * Full backup, version 1 (architecture.md "Backup format"). Rows are the synced entities as stored, non-deleted
 * only; the server export (P2-T04) uses the same shape.
 */
export type BackupV1 = {
  format: typeof BACKUP_FORMAT
  version: 1
  /** ms since the epoch */
  exported_at: number
  app_version: string
  decks: Deck[]
  cards: Card[]
  card_states: CardState[]
  review_log: ReviewLog[]
  settings: Settings
}

export type BackupCounts = { decks: number; cards: number; reviews: number }

export type ParseBackupResult =
  | { ok: true; backup: BackupV1 }
  | { ok: false; code: 'invalid_format' }
  /** The backup was written by a newer app; `required_version` is that app's version. */
  | { ok: false; code: 'unsupported_version'; required_version: string }

type Row = Record<string, unknown>

function isRow(value: unknown): value is Row {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function rowsWith(value: unknown, stringFields: string[]): value is Row[] {
  return (
    Array.isArray(value) && value.every((row) => isRow(row) && stringFields.every((f) => typeof row[f] === 'string'))
  )
}

/**
 * Checks a parsed JSON value: the format marker, the version and the minimal shape of every row, and that every
 * card, state and log points to a deck or card inside the backup.
 */
export function parseBackup(json: unknown): ParseBackupResult {
  const invalid = { ok: false, code: 'invalid_format' } as const
  if (!isRow(json) || json.format !== BACKUP_FORMAT || typeof json.version !== 'number') return invalid
  if (json.version > BACKUP_VERSION) {
    const required_version = typeof json.app_version === 'string' ? json.app_version : String(json.version)
    return { ok: false, code: 'unsupported_version', required_version }
  }
  if (json.version !== BACKUP_VERSION) return invalid
  const { decks, cards, card_states, review_log, settings } = json
  if (
    !rowsWith(decks, ['id', 'name', 'target_lang', 'native_lang']) ||
    !rowsWith(cards, ['id', 'deck_id', 'front', 'back']) ||
    !rowsWith(card_states, ['card_id', 'direction']) ||
    !rowsWith(review_log, ['id', 'card_id', 'direction']) ||
    !isRow(settings)
  ) {
    return invalid
  }
  const deckIds = new Set(decks.map((deck) => deck.id))
  const cardIds = new Set(cards.map((card) => card.id))
  if (
    !cards.every((card) => deckIds.has(card.deck_id as string)) ||
    !card_states.every((state) => cardIds.has(state.card_id as string)) ||
    !review_log.every((log) => cardIds.has(log.card_id as string))
  ) {
    return invalid
  }
  return { ok: true, backup: json as unknown as BackupV1 }
}

export function backupCounts(backup: BackupV1): BackupCounts {
  return { decks: backup.decks.length, cards: backup.cards.length, reviews: backup.review_log.length }
}

/** `annette-backup-YYYY-MM-DD.json` in local time. */
export function backupFilename(date: Date): string {
  return `annette-backup-${isoDate(date)}.json`
}

export function isoDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}
