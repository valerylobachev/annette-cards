import { canResume, newSnapshot, type StudySessionParams, type StudySessionSnapshot } from '@/domain/studySession'
import type { Card, Deck } from '@/domain/types'
import { newId } from '@/lib/ids'
import { deleteMeta, getMeta, setMeta } from './meta'
import { db } from './schema'
import { loadPracticeQueue, loadSession } from './studyQueries'

/**
 * The session to show on the study screen: the saved one when it can be resumed (within 30 min, same deck and
 * mode), otherwise a new one with a freshly built queue. A new session is saved only when it starts.
 */
export async function openStudySession(
  params: StudySessionParams,
  now: number,
): Promise<{ snapshot: StudySessionSnapshot; resumed: boolean }> {
  const saved = await getMeta('study_session')
  if (canResume(saved, params, now)) return { snapshot: saved, resumed: true }
  const deck = params.deck ?? undefined
  const queue = params.practice ? await loadPracticeQueue(deck) : await loadSession(now, deck)
  return { snapshot: newSnapshot(newId(), params, queue, now), resumed: false }
}

/** Device-local, never outboxed: answers themselves are saved by `answer()`. */
export function saveStudySession(snapshot: StudySessionSnapshot): Promise<void> {
  return setMeta('study_session', snapshot)
}

export function clearStudySession(): Promise<void> {
  return deleteMeta('study_session')
}

export type StudyCard = { card: Card; deck: Deck }

/** Cards of a session queue with their decks, by card id (deleted cards are left out). */
export async function loadStudyCards(ids: string[]): Promise<Map<string, StudyCard>> {
  const cards = (await db.cards.bulkGet(ids)).filter(
    (card): card is Card => card !== undefined && card.deleted_at === null,
  )
  const decks = await db.decks.bulkGet([...new Set(cards.map((card) => card.deck_id))])
  const deckById = new Map(decks.filter((deck) => deck !== undefined).map((deck) => [deck.id, deck] as const))
  const result = new Map<string, StudyCard>()
  for (const card of cards) {
    const deck = deckById.get(card.deck_id)
    if (deck) result.set(card.id, { card, deck })
  }
  return result
}
