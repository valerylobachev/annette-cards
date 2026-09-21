import Papa from 'papaparse'
import { isoDate } from '../backup/format'
import type { Card } from '../types'

/** Columns of the import format (README "Import format"), in order. */
export const CSV_COLUMNS = ['front', 'back', 'example', 'example_translation', 'ipa', 'tags', 'notes'] as const

/** One deck as CSV in the import format: header row, tags joined by spaces, RFC 4180 quoting. */
export function deckToCsv(cards: Card[]): string {
  const rows = cards.map((card) => [
    card.front,
    card.back,
    card.example ?? '',
    card.example_translation ?? '',
    card.ipa ?? '',
    card.tags.join(' '),
    card.notes ?? '',
  ])
  const csv = Papa.unparse({ fields: [...CSV_COLUMNS], data: rows }, { newline: '\r\n' })
  // Papa ends an empty table with a line break; every file ends with exactly one.
  return `${csv.replace(/(\r\n)+$/, '')}\r\n`
}

/** `<deck-name>-YYYY-MM-DD.csv`; characters that file systems reject are replaced. */
export function deckCsvFilename(deckName: string, date: Date): string {
  const safe = deckName.replace(/[\\/:*?"<>|\p{Cc}]+/gu, '_').trim() || 'deck'
  return `${safe}-${isoDate(date)}.csv`
}
