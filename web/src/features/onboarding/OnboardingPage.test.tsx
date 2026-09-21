import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { listDecks } from '@/db/decks'
import { db } from '@/db/schema'
import { getSettings } from '@/db/settings'
import { resetDb } from '@/test/db'
import { renderApp } from '@/test/render'
import { parseCustomGoal } from './OnboardingPage'

vi.mock('@/lib/platform', () => ({ isIosSafari: () => false, isStandalone: () => false }))

beforeEach(resetDb)
afterEach(() => vi.unstubAllGlobals())

async function goToGoalStep() {
  renderApp('/')
  await userEvent.click(await screen.findByRole('button', { name: 'Get started' }))
  await userEvent.click(await screen.findByRole('radio', { name: /British English/ }))
  await userEvent.click(screen.getByRole('button', { name: 'Next' }))
  await screen.findByRole('heading', { name: 'New words per day' })
}

describe('onboarding', () => {
  it('opens for a new user and keeps Next disabled until a studied language is chosen', async () => {
    renderApp('/')
    await userEvent.click(await screen.findByRole('button', { name: 'Get started' }))
    const next = await screen.findByRole('button', { name: 'Next' })
    expect(next).toBeDisabled()
    await userEvent.click(screen.getByRole('radio', { name: /Polish/ }))
    expect(next).toBeEnabled()
  })

  it('accepts a custom goal from 1 to 200 only', async () => {
    await goToGoalStep()
    await userEvent.click(screen.getByRole('button', { name: 'Custom' }))
    const input = screen.getByLabelText('Words per day')
    const next = screen.getByRole('button', { name: 'Next' })
    for (const [text, valid] of [
      ['0', false],
      ['201', false],
      ['2.5', false],
      ['1', true],
      ['200', true],
    ] as const) {
      await userEvent.clear(input)
      await userEvent.type(input, text)
      expect(next).toHaveProperty('disabled', !valid)
    }
  })

  it('creates the first deck and the goal, requests persistence, then opens Today', async () => {
    const persist = vi.fn(async () => true)
    vi.stubGlobal('navigator', Object.assign(Object.create(navigator), { storage: { persist } }))
    await goToGoalStep()
    await userEvent.click(screen.getByRole('button', { name: '10' }))
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByLabelText('Name')).toHaveValue('English')
    await userEvent.click(screen.getByRole('button', { name: /Start with an empty deck/ }))
    expect(await screen.findByRole('heading', { name: 'Hi there!' })).toBeInTheDocument()
    const [deck] = await listDecks()
    expect(deck).toMatchObject({ name: 'English', target_lang: 'en-GB', native_lang: 'ru' })
    expect((await getSettings()).new_per_day).toBe(10)
    expect(persist).toHaveBeenCalled()
    await waitFor(async () => expect((await db.meta.get('storage_persisted'))?.value).toBe(true))
  })
})

describe('parseCustomGoal', () => {
  it('accepts whole numbers within the new-cards limits', () => {
    expect(parseCustomGoal(' 42 ')).toBe(42)
    expect(parseCustomGoal('')).toBeNull()
    expect(parseCustomGoal('abc')).toBeNull()
  })
})
