import { createMemoryHistory, RouterProvider } from '@tanstack/react-router'
import { act, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import i18n from '@/i18n'
import { createAppRouter } from './router'

function renderAt(path: string) {
  const router = createAppRouter(createMemoryHistory({ initialEntries: [path] }))
  render(<RouterProvider router={router} />)
  return router
}

afterEach(async () => {
  await act(() => i18n.changeLanguage('en'))
})

describe('app shell', () => {
  it('renders the tab bar with four tabs', async () => {
    renderAt('/')
    const nav = await screen.findByRole('navigation', { name: 'Main navigation' })
    const tabs = within(nav).getAllByRole('link')
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Today', 'Decks', 'Statistics', 'Settings'])
  })

  it('hides the tab bar on full-screen routes', async () => {
    renderAt('/study?deck=abc&mode=swipe')
    await screen.findByRole('heading', { name: 'Study' })
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
  })

  it('switches tab labels between English and Russian', async () => {
    renderAt('/')
    const nav = await screen.findByRole('navigation')
    expect(within(nav).getByText('Today')).toBeInTheDocument()

    await act(() => i18n.changeLanguage('ru'))
    expect(within(nav).getByText('Сегодня')).toBeInTheDocument()
    expect(within(nav).queryByText('Today')).not.toBeInTheDocument()
  })
})
