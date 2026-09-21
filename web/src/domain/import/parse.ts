import Papa from 'papaparse'
import { looksLikeHeader } from './mapping'

export type Delimiter = ',' | ';' | '\t'

export type ParsedTable = {
  delimiter: Delimiter
  /** All non-empty rows, header included, padded to the same number of columns. */
  rows: string[][]
  hasHeaderGuess: boolean
}

const DELIMITERS: Delimiter[] = [',', ';', '\t']

/**
 * Parses CSV/TSV text; the delimiter is detected among `,` `;` and tab. `onProgress` gets the parsed share of the
 * text (0…1) every 1 000 rows.
 */
export function parseDelimited(text: string, onProgress?: (share: number) => void): ParsedTable {
  const rows: string[][] = []
  let delimiter: Delimiter = ','
  Papa.parse<string[]>(text, {
    delimiter: '',
    delimitersToGuess: DELIMITERS,
    skipEmptyLines: 'greedy',
    step: (result) => {
      delimiter = (DELIMITERS.find((d) => d === result.meta.delimiter) ?? ',') as Delimiter
      rows.push(result.data)
      if (onProgress && rows.length % 1000 === 0) onProgress(result.meta.cursor / text.length)
    },
  })
  const width = Math.max(0, ...rows.map((row) => row.length))
  const padded = rows.map((row) => (row.length < width ? [...row, ...Array(width - row.length).fill('')] : row))
  const first = padded[0]
  return { delimiter, rows: padded, hasHeaderGuess: first !== undefined && looksLikeHeader(first) }
}
