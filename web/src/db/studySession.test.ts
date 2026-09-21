import { beforeEach, describe, expect, it } from 'vitest'
import { applyAnswer } from '@/domain/studySession'
import { resetDb } from '@/test/db'
import { createCard, deleteCard } from './cards'
import { createDeck } from './decks'
import { db } from './schema'
import { clearStudySession, loadStudyCards, openStudySession, saveStudySession } from './studySession'

const MINUTE = 60_000

beforeEach(resetDb)

async function deckWithCards(fronts: string[]) {
  const deck = await createDeck({
    name: 'English',
    target_lang: 'en-GB',
    native_lang: 'ru',
    directions: 'forward',
    new_per_day: null,
  })
  const cards = []
  for (const front of fronts) cards.push(await createCard({ deck_id: deck.id, front, back: front }))
  return { deck, cards }
}

describe('study session store', () => {
  it('resumes the saved session within 30 minutes and builds a new one after', async () => {
    const { deck } = await deckWithCards(['a', 'b', 'c'])
    const params = { deck: deck.id, practice: false, repeat: null }
    const start = Date.now()
    const { snapshot, resumed } = await openStudySession(params, start)
    expect(resumed).toBe(false)
    expect(snapshot.queue).toHaveLength(3)

    const answered = applyAnswer(snapshot, { log_id: 'l1', nextDue: start + 86_400_000, reinsert: false }, start)
    await saveStudySession(answered)

    const later = await openStudySession(params, start + 29 * MINUTE)
    expect(later.resumed).toBe(true)
    expect(later.snapshot.id).toBe(snapshot.id)
    expect(later.snapshot.queue).toHaveLength(2)

    const tooLate = await openStudySession(params, start + 31 * MINUTE)
    expect(tooLate.resumed).toBe(false)
    expect(tooLate.snapshot.id).not.toBe(snapshot.id)
    expect(tooLate.snapshot.queue).toHaveLength(3)
  })

  it('never outboxes the session and forgets it when cleared', async () => {
    const { deck } = await deckWithCards(['a'])
    const params = { deck: deck.id, practice: false, repeat: null }
    const outboxBefore = await db.outbox.count()
    const { snapshot } = await openStudySession(params, Date.now())
    await saveStudySession(snapshot)
    expect(await db.outbox.count()).toBe(outboxBefore)
    expect((await openStudySession(params, Date.now())).resumed).toBe(true)
    await clearStudySession()
    expect((await openStudySession(params, Date.now())).resumed).toBe(false)
  })

  it('loads the queue cards with their decks and leaves deleted cards out', async () => {
    const { deck, cards } = await deckWithCards(['a', 'b'])
    const [a, b] = cards
    if (!a || !b) throw new Error('cards not created')
    await deleteCard(b.id)
    const loaded = await loadStudyCards([a.id, b.id, 'missing'])
    expect([...loaded.keys()]).toEqual([a.id])
    expect(loaded.get(a.id)?.deck.id).toBe(deck.id)
  })
})
