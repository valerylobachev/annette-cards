import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createCard } from '@/db/cards'
import { createDeck } from '@/db/decks'
import { db } from '@/db/schema'
import { updateSettings } from '@/db/settings'
import { resetDb } from '@/test/db'
import { renderApp } from '@/test/render'

type Spoken = { text: string; rate: number }
let spoken: Spoken[] = []

/** The Web Speech API as a recorder (jsdom has none); the silent unlock utterance is left out. */
function stubSpeech() {
  spoken = []
  class Utterance {
    text: string
    lang = ''
    rate = 1
    volume = 1
    voice: unknown = null
    onend: (() => void) | null = null
    onerror: (() => void) | null = null
    constructor(text: string) {
      this.text = text
    }
  }
  vi.stubGlobal('SpeechSynthesisUtterance', Utterance)
  vi.stubGlobal('speechSynthesis', {
    speak: (utterance: Utterance) => {
      if (utterance.text) spoken.push({ text: utterance.text, rate: utterance.rate })
      setTimeout(() => utterance.onend?.(), 0)
    },
    cancel: () => {},
    getVoices: () => [],
    addEventListener: () => {},
    removeEventListener: () => {},
  })
}

const WORDS: [string, string][] = [
  ['kot', 'кот'],
  ['pies', 'собака'],
  ['żółw', 'черепаха'],
  ['ryba', 'рыба'],
]

async function polishDeck(directions: 'forward' | 'reverse', words = WORDS) {
  const deck = await createDeck({ name: 'Polish', target_lang: 'pl-PL', native_lang: 'ru', directions, new_per_day: 1 })
  for (const [front, back] of words) await createCard({ deck_id: deck.id, front, back })
  return deck
}

async function start(path: string) {
  renderApp(path)
  await userEvent.click(await screen.findByRole('button', { name: 'Start' }))
}

const options = async () => within(await screen.findByRole('list', { name: 'Answers' })).getAllByRole('button')
const logs = () => db.review_log.toArray()

beforeEach(async () => {
  await resetDb()
  stubSpeech()
})
afterEach(() => {
  // Unmount first: the app's speech hooks unsubscribe from `speechSynthesis` on unmount.
  cleanup()
  vi.unstubAllGlobals()
})

describe('multiple choice', () => {
  it('offers four options and rates a correct answer Good by itself', async () => {
    const deck = await polishDeck('forward')
    await start(`/study?deck=${deck.id}&mode=choice`)
    const buttons = await options()
    expect(screen.getByText('kot')).toBeInTheDocument()
    expect(buttons.map((button) => button.textContent).sort()).toEqual(['кот', 'рыба', 'собака', 'черепаха'])

    await userEvent.click(screen.getByRole('button', { name: 'кот' }))
    await waitFor(async () => expect(await logs()).toMatchObject([{ rating: 3, mode: 'choice' }]))
    expect(screen.queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument()
  })

  it('marks a wrong answer, shows the card and waits for Continue (Again)', async () => {
    const deck = await polishDeck('forward')
    await start(`/study?deck=${deck.id}&mode=choice`)
    await options()
    await userEvent.click(screen.getByRole('button', { name: 'рыба' }))

    expect(screen.getByRole('button', { name: 'рыба' })).toHaveAttribute('data-state', 'wrong')
    expect(screen.getByRole('button', { name: 'кот' })).toHaveAttribute('data-state', 'correct')
    await new Promise((resolve) => setTimeout(resolve, 700))
    expect(await logs()).toEqual([])
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await waitFor(async () => expect(await logs()).toMatchObject([{ rating: 1, mode: 'choice' }]))
  })

  it('asks by typing when the language has no other word to offer', async () => {
    const deck = await polishDeck('reverse', [['kot', 'кот']])
    await start(`/study?deck=${deck.id}&mode=choice`)
    expect(await screen.findByRole('textbox', { name: 'Your answer' })).toBeInTheDocument()
  })
})

describe('listening', () => {
  it('plays the word once when shown, slower on request, and offers the written words', async () => {
    const deck = await polishDeck('reverse')
    await start(`/study?deck=${deck.id}&mode=listening`)
    await options()
    await waitFor(() => expect(spoken).toEqual([{ text: 'kot', rate: 1 }]))

    await userEvent.click(screen.getByRole('button', { name: 'Play slower' }))
    expect(spoken.at(-1)).toEqual({ text: 'kot', rate: 0.7 })
    await userEvent.click(screen.getByRole('button', { name: 'Play the word again' }))
    expect(spoken.at(-1)).toEqual({ text: 'kot', rate: 1 })

    const fronts = (await options()).map((button) => button.textContent).sort()
    expect(fronts).toEqual(['kot', 'pies', 'ryba', 'żółw'])
    await userEvent.click(screen.getByRole('button', { name: 'kot' }))
    await waitFor(async () => expect(await logs()).toMatchObject([{ rating: 3, mode: 'listen' }]))
  })

  it('is answered by typing when set so; a missing diacritic is Hard', async () => {
    await updateSettings({ listening_answer: 'type' })
    const deck = await polishDeck('forward', [
      ['żółw', 'черепаха'],
      ['kot', 'кот'],
    ])
    await start(`/study?deck=${deck.id}&mode=listening`)
    await userEvent.type(await screen.findByRole('textbox', { name: 'Your answer' }), 'zolw{Enter}')
    expect(await screen.findByText('Almost')).toBeInTheDocument()
    expect(spoken).toEqual([{ text: 'żółw', rate: 1 }])
    await userEvent.keyboard('{Enter}')
    await waitFor(async () => expect(await logs()).toMatchObject([{ rating: 2, mode: 'listen', direction: 'forward' }]))
  })
})
