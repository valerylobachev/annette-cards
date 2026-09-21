import { normalizeFront } from '../normalize'

/** Card fields a column can be mapped to (S-10 step 2). */
export const IMPORT_FIELDS = [
  'front',
  'back',
  'example',
  'example_translation',
  'ipa',
  'tags',
  'notes',
  'ignore',
] as const

export type ImportField = (typeof IMPORT_FIELDS)[number]
export type CardImportField = Exclude<ImportField, 'ignore'>

/** Header names recognized per field (README "Import format"), compared after `normalizeFront`. */
export const HEADER_SYNONYMS: Record<CardImportField, string[]> = {
  front: ['front', 'word', 'term', 'слово', 'термин'],
  back: ['back', 'translation', 'meaning', 'перевод', 'значение'],
  example: ['example', 'sentence', 'пример'],
  example_translation: ['example_translation', 'example translation', 'перевод примера'],
  ipa: ['ipa', 'transcription', 'транскрипция'],
  tags: ['tags', 'tag', 'теги', 'тег'],
  notes: ['notes', 'note', 'comment', 'заметки', 'комментарий'],
}

const fieldBySynonym = new Map<string, CardImportField>(
  Object.entries(HEADER_SYNONYMS).flatMap(([field, names]) =>
    names.map((name): [string, CardImportField] => [normalizeFront(name), field as CardImportField]),
  ),
)

export function fieldForHeader(header: string): CardImportField | undefined {
  return fieldBySynonym.get(normalizeFront(header))
}

/** Maps header cells to fields by synonym; unknown headers and repeats of an already mapped field → `ignore`. */
export function autoMap(headers: string[]): ImportField[] {
  const used = new Set<CardImportField>()
  return headers.map((header) => {
    const field = fieldForHeader(header)
    if (!field || used.has(field)) return 'ignore'
    used.add(field)
    return field
  })
}

/** Without a header row: column 1 → front, column 2 → back, the rest ignored. */
export function defaultMapping(columnCount: number): ImportField[] {
  return Array.from({ length: columnCount }, (_, i): ImportField => (i === 0 ? 'front' : i === 1 ? 'back' : 'ignore'))
}

/** A first row with at least two recognized header names is treated as a header. */
export function looksLikeHeader(row: string[]): boolean {
  return new Set(row.map(fieldForHeader).filter(Boolean)).size >= 2
}
