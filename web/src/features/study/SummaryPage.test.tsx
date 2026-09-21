import { screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { createCard } from '@/db/cards'
import { createDeck } from '@/db/decks'
import { answer } from '@/db/study'
import { saveStudySession } from '@/db/studySession'
import { newSnapshot } from '@/domain/studySession'
import type { Rating } from '@/domain/types'
import { resetDb } from '@/test/db'
import { renderApp } from '@/test/render'

beforeEach(resetDb)

describe('session summary', () => {
  it('shows 75 % accuracy for 3 Good and 1 Again, and the failed card', async () => {
    const deck = await createDeck({
      name: 'English',
      target_lang: 'en-GB',
      native_lang: 'ru',
      directions: 'forward',
      new_per_day: null,
    })
    const ratings: [string, Rating][] = [
      ['cat', 3],
      ['dog', 3],
      ['owl', 3],
      ['fox', 1],
    ]
    const log_ids = []
    for (const [front, rating] of ratings) {
      const card = await createCard({ deck_id: deck.id, front, back: `${front}-ru` })
      const result = await answer({ card_id: card.id, direction: 'forward', rating, mode: 'swipe', duration_ms: 5000 })
      log_ids.push(result.log_id)
    }
    const params = { deck: null, practice: false, repeat: null }
    await saveStudySession({ ...newSnapshot('s1', params, [], 0), log_ids, finished_at: Date.now() })

    renderApp('/study/summary?session=s1')
    expect(await screen.findByText('75%')).toBeInTheDocument()
    expect(screen.getByText('20 sec')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'fox — fox-ru' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Repeat these now' })).toHaveAttribute(
      'href',
      '/study?practice=1&repeat=s1',
    )
  })

  it('explains when the session is no longer stored', async () => {
    renderApp('/study/summary?session=gone')
    expect(await screen.findByText('This session summary is no longer available.')).toBeInTheDocument()
  })
})
