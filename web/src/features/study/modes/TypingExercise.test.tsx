import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { createCard } from '@/db/cards'
import { createDeck } from '@/db/decks'
import { db } from '@/db/schema'
import { resetDb } from '@/test/db'
import { renderApp } from '@/test/render'

beforeEach(resetDb)

/** A Polish deck studied in reverse: the prompt is the translation, the answer the Polish word. */
async function polishDeck(words: [string, string][]) {
  const deck = await createDeck({
    name: 'Polish',
    target_lang: 'pl-PL',
    native_lang: 'ru',
    directions: 'reverse',
    new_per_day: null,
  })
  for (const [front, back] of words) await createCard({ deck_id: deck.id, front, back })
  return deck
}

async function startTyping(deckId: string) {
  renderApp(`/study?deck=${deckId}&mode=typing`)
  await userEvent.click(await screen.findByRole('button', { name: 'Start' }))
  return screen.findByRole('textbox', { name: 'Your answer' })
}

const logs = () => db.review_log.toArray()

describe('typing mode', () => {
  it('accepts an exact answer and moves on by itself with Good', async () => {
    const deck = await polishDeck([
      ['kot', 'кот'],
      ['pies', 'собака'],
    ])
    const input = await startTyping(deck.id)
    expect(screen.getByText('кот')).toBeInTheDocument()
    await userEvent.type(input, 'Kot{Enter}')

    expect(await screen.findByText('Correct!')).toBeInTheDocument()
    await screen.findByText('собака')
    const [log] = await logs()
    expect(log).toMatchObject({ rating: 3, mode: 'typing' })
    expect(input).toHaveValue('')
  })

  it('shows a near miss with the missing diacritics and rates it Hard on Continue', async () => {
    const deck = await polishDeck([
      ['żółw', 'черепаха'],
      ['pies', 'собака'],
    ])
    const input = await startTyping(deck.id)
    await userEvent.type(input, 'zolw{Enter}')

    expect(await screen.findByText('Almost')).toBeInTheDocument()
    const diacritics = screen.getByTestId('typing-diff').querySelector('[data-kind="diacritic"]')
    expect(diacritics).toHaveTextContent('żół')
    expect(await logs()).toEqual([])

    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByText('собака')
    expect(await logs()).toMatchObject([{ rating: 2, mode: 'typing' }])
  })

  it('shows the correct answer after a wrong one and rates "I don\'t know" Again', async () => {
    const deck = await polishDeck([
      ['kot', 'кот'],
      ['pies', 'собака'],
    ])
    const input = await startTyping(deck.id)
    await userEvent.type(input, 'pies{Enter}')
    expect(await screen.findByText('Correct answer')).toBeInTheDocument()
    expect(screen.getByTestId('typing-correct-answer')).toHaveTextContent('kot')
    await userEvent.keyboard('{Enter}')
    await screen.findByText('собака')

    await userEvent.click(screen.getByRole('button', { name: "I don't know" }))
    expect(screen.getByTestId('typing-correct-answer')).toHaveTextContent('pies')
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await waitFor(async () => expect((await logs()).map((log) => log.rating)).toEqual([1, 1]))
  })

  it('does not check an empty answer', async () => {
    const deck = await polishDeck([['kot', 'кот']])
    const input = await startTyping(deck.id)
    expect(screen.getByRole('button', { name: 'Check' })).toBeDisabled()
    await userEvent.type(input, '  {Enter}')
    expect(screen.queryByText('Correct answer')).not.toBeInTheDocument()
  })
})
