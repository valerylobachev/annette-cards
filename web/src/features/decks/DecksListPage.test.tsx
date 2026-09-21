import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { createDeck } from '@/db/decks'
import { resetDb } from '@/test/db'
import { renderApp } from '@/test/render'

beforeEach(resetDb)

describe('decks list', () => {
  it('creates a deck through the sheet', async () => {
    const user = userEvent.setup()
    renderApp('/decks')

    await user.click(await screen.findByRole('button', { name: 'Create deck' }))
    const sheet = await screen.findByRole('dialog', { name: 'New deck' })
    await user.type(within(sheet).getByLabelText('Name'), 'English B2')
    await user.click(within(sheet).getByRole('radio', { name: 'Forward' }))
    await user.click(within(sheet).getByRole('button', { name: 'Create' }))

    const list = await screen.findByRole('list', { name: 'Decks' })
    expect(await within(list).findByText('English B2')).toBeInTheDocument()
    expect(within(list).getByText(/EN-GB → RU · 0 cards/)).toBeInTheDocument()
  })

  it('shows a validation error for an empty name', async () => {
    const user = userEvent.setup()
    renderApp('/decks')
    await user.click(await screen.findByRole('button', { name: 'New deck' }))
    const sheet = await screen.findByRole('dialog', { name: 'New deck' })
    await user.click(within(sheet).getByRole('button', { name: 'Create' }))
    expect(within(sheet).getByText('Required')).toBeInTheDocument()
  })

  it('archive moves the deck to the Archived section', async () => {
    await createDeck({ name: 'Polish', target_lang: 'pl-PL', native_lang: 'ru', directions: 'both', new_per_day: null })
    const user = userEvent.setup()
    renderApp('/decks')

    // Radix menus open on pointerdown, which jsdom does not fully emulate; the keyboard path is equivalent.
    ;(await screen.findByRole('button', { name: 'Actions for Polish' })).focus()
    await user.keyboard('{Enter}')
    await user.click(await screen.findByRole('menuitem', { name: 'Archive' }))

    const toggle = await screen.findByRole('button', { name: 'Archived (1)' })
    await waitFor(() => expect(within(screen.getByRole('list', { name: 'Decks' })).queryByText('Polish')).toBeNull())
    await user.click(toggle)
    expect(within(screen.getByRole('list', { name: 'Archived (1)' })).getByText('Polish')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Deck archived')
  })
})
