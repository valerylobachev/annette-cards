import { useLiveQuery } from 'dexie-react-hooks'
import { DEFAULT_SETTINGS } from '@/domain/settings'
import { getCardStates } from './cardStates'
import { getCard, listCards } from './cards'
import { getDeck, listDecks } from './decks'
import { db } from './schema'
import { toSettings } from './settings'

// Reactive reads for components: they re-render when a transaction commits changes to the queried tables.
// `undefined` means "still loading" (the first render before IndexedDB answers).

export function useDecks() {
  return useLiveQuery(() => listDecks())
}

export function useDeck(id: string) {
  return useLiveQuery(() => getDeck(id), [id])
}

export function useCards(deck_id: string) {
  return useLiveQuery(() => listCards(deck_id), [deck_id])
}

export function useCard(id: string) {
  return useLiveQuery(() => getCard(id), [id])
}

export function useCardStates(card_id: string) {
  return useLiveQuery(() => getCardStates(card_id), [card_id])
}

/** Settings are never "loading": defaults are used until the stored row is read. */
export function useSettings() {
  return useLiveQuery(async () => toSettings(await db.settings.get('user')), [], DEFAULT_SETTINGS)
}
