import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setMeta } from '@/db/meta'
import { db } from '@/db/schema'
import { ME, setOnline } from '@/test/api'
import { resetDb } from '@/test/db'
import { SyncIndicator } from './SyncIndicator'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, ...props }: { children: React.ReactNode; to: string }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}))

const { running, RUNNING, IDLE } = vi.hoisted(() => ({
  running: { value: false },
  RUNNING: { running: true },
  IDLE: { running: false },
}))
vi.mock('./engine', () => ({
  subscribeEngine: () => () => {},
  // Stable snapshots, as useSyncExternalStore requires.
  engineState: () => (running.value ? RUNNING : IDLE),
  resetEngine: () => {},
}))

beforeEach(async () => {
  await resetDb()
  running.value = false
})
afterEach(() => setOnline(true))

const signIn = () =>
  setMeta('account', { user_id: ME.id, email: ME.email, display_name: ME.display_name, is_admin: false })

describe('SyncIndicator', () => {
  it('is hidden when signed out', async () => {
    const { container } = render(<SyncIndicator />)
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)))
    expect(container).toBeEmptyDOMElement()
  })

  it('shows synced, pending with the count, offline and syncing', async () => {
    await signIn()
    const { rerender } = render(<SyncIndicator />)
    expect(await screen.findByRole('link', { name: 'Synced' })).toBeInTheDocument()

    await db.outbox.bulkAdd([
      { entity: 'decks', entity_id: 'd1' },
      { entity: 'cards', entity_id: 'c1' },
    ])
    const pending = await screen.findByRole('link', { name: '2 changes waiting to sync' })
    expect(pending).toHaveTextContent('2')

    act(() => setOnline(false))
    expect(await screen.findByRole('link', { name: /Offline/ })).toBeInTheDocument()

    act(() => setOnline(true))
    running.value = true
    rerender(<SyncIndicator key="again" />)
    expect(await screen.findByRole('link', { name: 'Syncing' })).toBeInTheDocument()
  })

  it('shows an error after a failed run or an expired session', async () => {
    await signIn()
    await setMeta('sync_log', [
      { started_at: 1, finished_at: 2, status: 'error', pushed: 0, pulled: 0, rejected: [], error_code: 'network' },
    ])
    render(<SyncIndicator />)
    expect(await screen.findByRole('link', { name: 'Sync failed' })).toHaveAttribute('data-state', 'error')
  })
})
