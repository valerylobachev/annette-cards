import type { BackupV1 } from './format'

/**
 * Gives every deck, card and review log a new id and rewrites the references, so the backup can be added next to
 * existing data ("Add as new decks", UC-25). States follow their card's new id. Pure: `newId` is injected.
 */
export function remapIds(backup: BackupV1, newId: () => string): BackupV1 {
  const deckIds = new Map(backup.decks.map((deck) => [deck.id, newId()]))
  const cardIds = new Map(backup.cards.map((card) => [card.id, newId()]))
  const mapped = (ids: Map<string, string>, id: string) => {
    const next = ids.get(id)
    if (next === undefined) throw new Error(`Backup references unknown id ${id}`)
    return next
  }
  return {
    ...backup,
    decks: backup.decks.map((deck) => ({ ...deck, id: mapped(deckIds, deck.id) })),
    cards: backup.cards.map((card) => ({
      ...card,
      id: mapped(cardIds, card.id),
      deck_id: mapped(deckIds, card.deck_id),
    })),
    card_states: backup.card_states.map((state) => ({ ...state, card_id: mapped(cardIds, state.card_id) })),
    review_log: backup.review_log.map((log) => ({ ...log, id: newId(), card_id: mapped(cardIds, log.card_id) })),
  }
}
