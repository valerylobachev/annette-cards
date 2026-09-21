import type { ImportField } from '@/domain/import/mapping'
import type { ParsedTable } from '@/domain/import/parse'
import type { ValidatedRow } from '@/domain/import/validate'

/** Messages to the import worker. */
export type WorkerRequest =
  | { type: 'parse'; bytes: ArrayBuffer }
  | { type: 'parse'; text: string }
  | { type: 'validate'; rows: string[][]; mapping: ImportField[]; existingFronts: string[] }

/** Messages from the import worker; `progress` may repeat before the final message. */
export type WorkerResponse =
  | { type: 'progress'; share: number }
  | { type: 'parsed'; table: ParsedTable }
  | { type: 'failed'; code: 'not_utf8' | 'empty' }
  | { type: 'validated'; rows: ValidatedRow[] }
