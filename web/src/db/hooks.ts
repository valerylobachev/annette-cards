import { useLiveQuery } from 'dexie-react-hooks'
import { DEFAULT_SETTINGS } from '@/domain/settings'
import type { Direction } from '@/domain/types'
import { now } from '@/lib/clock'
import { getCardStates } from './cardStates'
import { getCard, listCards, listDeckCardsWithStates, listTags } from './cards'
import { getDeck, listDeckSummaries, listDecks } from './decks'
import { getMeta, type MetaKey } from './meta'
import { recentReviews } from './reviewLog'
import { db } from './schema'
import { toSettings } from './settings'
import { loadToday } from './studyQueries'
import { loadFinishedSession } from './studySession'

// Reactive reads for components: they re-render when a transaction commits changes to the queried tables.
// `undefined` means "still loading" (the first render before IndexedDB answers); `null` means "not found".

export function useDecks() {
  return useLiveQuery(() => listDecks())
}

export function useDeck(id: string) {
  return useLiveQuery(async () => (await getDeck(id)) ?? null, [id])
}

export function useCards(deck_id: string) {
  return useLiveQuery(() => listCards(deck_id), [deck_id])
}

export function useCard(id: string) {
  return useLiveQuery(async () => (await getCard(id)) ?? null, [id])
}

export function useTags() {
  return useLiveQuery(() => listTags(), [], [])
}

/** A device-local value; `null` when it was never set. */
export function useMeta<K extends MetaKey>(key: K) {
  return useLiveQuery(async () => (await getMeta(key)) ?? null, [key])
}

export function useCardStates(card_id: string) {
  return useLiveQuery(() => getCardStates(card_id), [card_id])
}

/** Settings are never "loading": defaults are used until the stored row is read. */
export function useSettings() {
  return useLiveQuery(async () => toSettings(await db.settings.get('user')), [], DEFAULT_SETTINGS)
}

export function useDeckSummaries() {
  return useLiveQuery(() => listDeckSummaries())
}

/** `null` when the deck does not exist. */
export function useDeckCards(deck_id: string) {
  return useLiveQuery(() => listDeckCardsWithStates(deck_id), [deck_id])
}

export function useRecentReviews(card_id: string, direction: Direction) {
  return useLiveQuery(() => recentReviews(card_id, direction), [card_id, direction], [])
}

/**
 * Today (S-04) counts, streak and decks due. `now` is read when the query runs (on mount and on every database
 * change), so cards that became due while nothing changed appear on the next change or remount.
 */
export function useToday() {
  return useLiveQuery(() => loadToday(now()))
}

/** The summary of a finished session; `null` when it is no longer stored. */
export function useFinishedSession(id: string) {
  return useLiveQuery(() => loadFinishedSession(id), [id])
}
