/**
 * Writes the 10 000-row import CSV of the performance pass (P4-T06):
 * `node tests/fixtures/generate-cards.ts [out.csv] [rows]`. The generators themselves are in `bigDeck.ts`.
 */
import { writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { BIG_DECK_SIZE, generateCsv } from './bigDeck.ts'

export { BIG_DECK_SIZE, generateCsv, generateStudyData, wordOf } from './bigDeck.ts'

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const out = process.argv[2] ?? 'big-deck.csv'
  const rows = Number(process.argv[3] ?? BIG_DECK_SIZE)
  writeFileSync(out, generateCsv(rows))
  console.log(`${out}: ${rows} rows`)
}
