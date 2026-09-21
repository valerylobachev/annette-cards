import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setMeta } from '@/db/meta'
import { ME } from '@/test/api'
import { resetDb } from '@/test/db'
import { PullToSync } from './PullToSync'

const syncNow = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('./engine', () => ({ syncNow, resetEngine: () => {} }))

beforeEach(async () => {
  await resetDb()
  syncNow.mockClear()
})

function pull(target: HTMLElement, distance: number) {
  fireEvent.touchStart(target, { touches: [{ clientY: 100 }] })
  fireEvent.touchMove(target, { touches: [{ clientY: 100 + distance }] })
  fireEvent.touchEnd(target)
}

describe('PullToSync', () => {
  it('syncs when pulled far enough while signed in', async () => {
    await setMeta('account', { user_id: ME.id, email: ME.email, display_name: ME.display_name, is_admin: false })
    const { container } = render(
      <PullToSync>
        <p>Today</p>
      </PullToSync>,
    )
    // The gesture is attached once the account has loaded.
    await vi.waitFor(() => expect(container.querySelector('[data-pull-to-sync]')).not.toBeNull())
    const content = screen.getByText('Today')
    pull(content, 30)
    expect(syncNow).not.toHaveBeenCalled()
    pull(content, 90)
    expect(syncNow).toHaveBeenCalledWith('manual')
  })

  it('does nothing when signed out', async () => {
    render(
      <PullToSync>
        <p>Today</p>
      </PullToSync>,
    )
    pull(await screen.findByText('Today'), 90)
    expect(syncNow).not.toHaveBeenCalled()
  })
})
