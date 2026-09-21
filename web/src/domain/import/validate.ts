import { CARD_LIMITS } from '../cardValidation'
import { normalizeFront } from '../normalize'
import type { CardImportField, ImportField } from './mapping'

/** Card fields taken from one row. Only mapped fields are present; blank optional cells are `null`. */
export type ImportCard = {
  front: string
  back: string
  example?: string | null
  example_translation?: string | null
  ipa?: string | null
  tags?: string[]
  notes?: string | null
}

export type ImportErrorCode = 'missing_front' | 'missing_back' | 'too_long'
export type ImportError = { code: ImportErrorCode; field?: CardImportField; max?: number }

export type ValidatedRow =
  /** `row` is 1-based and counts data rows only (the header row is excluded). */
  | { row: number; status: 'ready'; card: ImportCard }
  /** `of`: the front already exists in the deck, or in an earlier row of the file. */
  | { row: number; status: 'duplicate'; of: 'deck' | 'file'; card: ImportCard }
  | { row: number; status: 'error'; errors: ImportError[] }

export type ValidationSummary = { ready: number; duplicates: number; errors: number }

/** Tags are separated by spaces or `;` (README "Import format"). */
export function splitTags(cell: string): string[] {
  return cell.split(/[\s;]+/).filter((tag) => tag !== '')
}

const optionalFields = ['example', 'example_translation', 'ipa', 'notes'] as const

function length(value: string) {
  return [...value].length
}

function toCard(cells: string[], mapping: ImportField[]): ImportCard {
  const cell = (field: CardImportField) => {
    const index = mapping.indexOf(field)
    return index === -1 ? undefined : (cells[index] ?? '').trim()
  }
  const card: ImportCard = { front: cell('front') ?? '', back: cell('back') ?? '' }
  for (const field of optionalFields) {
    const value = cell(field)
    if (value !== undefined) card[field] = value === '' ? null : value
  }
  const tags = cell('tags')
  if (tags !== undefined) card.tags = splitTags(tags)
  return card
}

function errorsOf(card: ImportCard): ImportError[] {
  const errors: ImportError[] = []
  if (card.front === '') errors.push({ code: 'missing_front' })
  if (card.back === '') errors.push({ code: 'missing_back' })
  for (const field of ['front', 'back', ...optionalFields] as const) {
    const value = card[field]
    if (value && length(value) > CARD_LIMITS[field]) errors.push({ code: 'too_long', field, max: CARD_LIMITS[field] })
  }
  if (card.tags?.some((tag) => length(tag) > CARD_LIMITS.tag)) {
    errors.push({ code: 'too_long', field: 'tags', max: CARD_LIMITS.tag })
  }
  return errors
}

/**
 * Checks every data row (UC-10 step 5). Duplicates are found by `normalizeFront` against `existingFronts` (the
 * normalized fronts of the target deck's cards) and against earlier valid rows of the same file.
 */
export function validateRows(
  rows: string[][],
  mapping: ImportField[],
  existingFronts: Iterable<string>,
  onProgress?: (share: number) => void,
): ValidatedRow[] {
  const inDeck = new Set(existingFronts)
  const inFile = new Set<string>()
  return rows.map((cells, index): ValidatedRow => {
    if (onProgress && index > 0 && index % 1000 === 0) onProgress(index / rows.length)
    const row = index + 1
    const card = toCard(cells, mapping)
    const errors = errorsOf(card)
    if (errors.length > 0) return { row, status: 'error', errors }
    const key = normalizeFront(card.front)
    if (inDeck.has(key)) return { row, status: 'duplicate', of: 'deck', card }
    if (inFile.has(key)) return { row, status: 'duplicate', of: 'file', card }
    inFile.add(key)
    return { row, status: 'ready', card }
  })
}

export function summarize(rows: ValidatedRow[]): ValidationSummary {
  const summary: ValidationSummary = { ready: 0, duplicates: 0, errors: 0 }
  for (const row of rows) {
    if (row.status === 'ready') summary.ready++
    else if (row.status === 'duplicate') summary.duplicates++
    else summary.errors++
  }
  return summary
}

/** The error report file: a `row,reason` CSV with one line per error; `describe` localizes each error. */
export function errorReportCsv(rows: ValidatedRow[], header: [string, string], describe: (e: ImportError) => string) {
  const quote = (value: string) => (/[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value)
  const lines = [header.map(quote).join(',')]
  for (const row of rows) {
    if (row.status !== 'error') continue
    for (const error of row.errors) lines.push(`${row.row},${quote(describe(error))}`)
  }
  return `${lines.join('\r\n')}\r\n`
}
