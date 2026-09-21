import { beforeEach, describe, expect, it } from 'vitest'
import { resetDb } from '@/test/db'
import { createCard } from './cards'
import { createDeck } from './decks'
import { getMeta } from './meta'
import { db } from './schema'
import { updateSettings } from './settings'
import { addExtraNew, getExtraNew, loadSession } from './studyQueries'

const at = (day: number, hour: number) => new Date(2026, 8, day, hour).getTime()

beforeEach(resetDb)

describe('extra new allowance', () => {
  it('adds up on one study day, resets on the next and never creates outbox entries', async () => {
    await addExtraNew(at(21, 12))
    expect(await addExtraNew(at(21, 13))).toBe(20)
    expect(await getExtraNew('2026-09-21')).toBe(20)
    // 03:00 on the 22nd still belongs to the 21st (day starts at 04:00).
    expect(await addExtraNew(at(22, 3))).toBe(30)

    expect(await addExtraNew(at(22, 5))).toBe(10)
    expect(await getMeta('extra_new')).toEqual({ study_day: '2026-09-22', count: 10 })
    expect(await getExtraNew('2026-09-21')).toBe(0)
    expect(await db.outbox.count()).toBe(0)
  })
})

describe('loadSession', () => {
  it('builds the queue from the database with the extra allowance of today', async () => {
    await updateSettings({ new_per_day: 2 })
    const deck = await createDeck({
      name: 'English',
      target_lang: 'en-GB',
      native_lang: 'ru',
      directions: 'forward',
      new_per_day: null,
    })
    for (const front of ['a', 'b', 'c', 'd', 'e']) await createCard({ deck_id: deck.id, front, back: front })
    const now = Date.now()

    expect(await loadSession(now)).toHaveLength(2)
    await addExtraNew(now, 2)
    expect(await loadSession(now)).toHaveLength(4)
    expect(await loadSession(now, 'other-deck')).toHaveLength(0)
  })
})
