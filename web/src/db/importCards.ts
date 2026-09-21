import { cleanTags } from '@/domain/cardValidation'
import type { ImportCard } from '@/domain/import/validate'
import { normalizeFront } from '@/domain/normalize'
import type { Card } from '@/domain/types'
import { newId } from '@/lib/ids'
import { ensureStatesForCards } from './cardStates'
import { listCards, writeCard } from './cards'
import { requireDeckInTx } from './decks'
import { mutate } from './write'

/**
 * What happens to a row whose front already exists in the deck (or in an earlier row): `skip` it, `update` the
 * existing card, or `import_anyway` as a new card.
 */
export type DuplicateStrategy = 'skip' | 'update' | 'import_anyway'

export type ImportCounts = { inserted: number; updated: number; skipped: number }

export const IMPORT_BATCH_SIZE = 500

/**
 * Imports validated rows into a deck (UC-10 step 7), `IMPORT_BATCH_SIZE` rows per transaction; every card is
 * stamped, gets New states for the deck's active directions and outbox entries. `onProgress` gets the share of
 * rows done after each batch.
 *
 * `update` overwrites the fields that have a non-blank value in the row and keeps the card's states; blank or
 * unmapped cells keep the existing value.
 */
export async function importRows(
  deck_id: string,
  rows: ImportCard[],
  strategy: DuplicateStrategy,
  onProgress?: (share: number) => void,
): Promise<ImportCounts> {
  const counts: ImportCounts = { inserted: 0, updated: 0, skipped: 0 }
  // Card id per normalized front: the deck's cards, then each card this import creates.
  const byFront = new Map<string, string>()
  for (const card of await listCards(deck_id)) byFront.set(normalizeFront(card.front), card.id)

  for (let start = 0; start < rows.length; start += IMPORT_BATCH_SIZE) {
    const batch = rows.slice(start, start + IMPORT_BATCH_SIZE)
    await mutate(['decks', 'cards', 'card_states'], async (ctx) => {
      const deck = await requireDeckInTx(ctx, deck_id)
      const inserted: Card[] = []
      for (const row of batch) {
        const key = normalizeFront(row.front)
        const existingId = byFront.get(key)
        if (existingId !== undefined && strategy === 'skip') {
          counts.skipped++
          continue
        }
        const existing =
          existingId !== undefined && strategy === 'update' ? await ctx.db.cards.get(existingId) : undefined
        if (existing) {
          await writeCard(ctx, { ...existing, ...filledFields(row) })
          counts.updated++
          continue
        }
        const card = await writeCard(ctx, {
          id: newId(),
          deck_id,
          front: row.front,
          back: row.back,
          example: row.example ?? null,
          example_translation: row.example_translation ?? null,
          ipa: row.ipa ?? null,
          tags: cleanTags(row.tags ?? []),
          notes: row.notes ?? null,
          audio_id: null,
          created_at: ctx.now,
          deleted_at: null,
          updated_at: ctx.now,
          updated_by: ctx.deviceId,
        })
        inserted.push(card)
        if (existingId === undefined) byFront.set(key, card.id)
        counts.inserted++
      }
      await ensureStatesForCards(ctx, inserted, deck)
    })
    onProgress?.(Math.min(1, (start + batch.length) / rows.length))
  }
  return counts
}

function filledFields(row: ImportCard): Partial<Card> {
  const fields: Partial<Card> = { front: row.front, back: row.back }
  for (const name of ['example', 'example_translation', 'ipa', 'notes'] as const) {
    const value = row[name]
    if (value) fields[name] = value
  }
  if (row.tags && row.tags.length > 0) fields.tags = cleanTags(row.tags)
  return fields
}
