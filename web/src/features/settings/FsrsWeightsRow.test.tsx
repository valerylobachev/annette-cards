import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setMeta } from '@/db/meta'
import { getSettings } from '@/db/settings'
import { mockApi, setOnline } from '@/test/api'
import { resetDb } from '@/test/db'
import { renderApp } from '@/test/render'

const engine = vi.hoisted(() => ({ syncNow: vi.fn(async () => {}) }))
vi.mock('@/features/sync/engine', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/sync/engine')>()),
  syncNow: engine.syncNow,
}))

const WEIGHTS = Array.from({ length: 21 }, (_, i) => 0.5 + i / 10)

function mockOptimize(status: number, body: unknown) {
  return mockApi([
    {
      path: '/api/meta',
      body: { version: '0.1.0', features: { tts: false, commons: false, enrich: false, push: false } },
    },
    { method: 'POST', path: '/api/fsrs/optimize', status, body },
  ])
}

async function optimizeButton() {
  renderApp('/settings')
  return screen.findByRole('button', { name: 'Optimize' })
}

beforeEach(async () => {
  await resetDb()
  await setMeta('install_hint_shown', true)
  await setMeta('account', { user_id: 'u1', email: 'anna@example.com', display_name: 'Anna', is_admin: false })
  engine.syncNow.mockClear()
})

afterEach(() => {
  vi.unstubAllGlobals()
  setOnline(true)
})

describe('FSRS weights', () => {
  it('syncs, shows the comparison and applies the weights', async () => {
    const api = mockOptimize(200, {
      weights: WEIGHTS,
      log_loss_default: 0.4,
      log_loss_optimized: 0.3,
      review_count: 1234,
    })
    const button = await optimizeButton()
    await waitFor(() => expect(button).toBeEnabled())
    await userEvent.click(button)

    const sheet = await screen.findByRole('dialog', { name: 'Optimized weights' })
    const optimizeCall = api.mock.calls.findIndex(([input]) => String(input).endsWith('/api/fsrs/optimize'))
    expect(engine.syncNow.mock.invocationCallOrder[0]).toBeLessThan(api.mock.invocationCallOrder[optimizeCall] ?? 0)
    expect(within(sheet).getByText('Fitted to 1234 reviews')).toBeInTheDocument()
    expect(within(sheet).getByText('0.4')).toBeInTheDocument()
    expect(within(sheet).getByText('0.3')).toBeInTheDocument()
    expect(within(sheet).getByText('25% more accurate')).toBeInTheDocument()

    await userEvent.click(within(sheet).getByRole('button', { name: 'Apply' }))
    await waitFor(async () => expect((await getSettings()).fsrs_weights).toEqual(WEIGHTS))
    expect((await getSettings()).fsrs_optimized_at).toEqual(expect.any(Number))
    expect(await screen.findByText(/^Optimized on /)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Reset to default' }))
    await waitFor(async () => expect((await getSettings()).fsrs_weights).toBeNull())
  })

  it('cancel changes nothing', async () => {
    mockOptimize(200, { weights: WEIGHTS, log_loss_default: 0.4, log_loss_optimized: 0.41, review_count: 1000 })
    const button = await optimizeButton()
    await waitFor(() => expect(button).toBeEnabled())
    await userEvent.click(button)
    const sheet = await screen.findByRole('dialog', { name: 'Optimized weights' })
    expect(within(sheet).getByText('Not more accurate than the default weights.')).toBeInTheDocument()
    await userEvent.click(within(sheet).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect((await getSettings()).fsrs_weights).toBeNull()
  })

  it('explains how many reviews are missing', async () => {
    mockOptimize(422, { code: 'not_enough_reviews', details: { count: 640, required: 1000 } })
    const button = await optimizeButton()
    await waitFor(() => expect(button).toBeEnabled())
    await userEvent.click(button)
    expect(await screen.findByRole('alert')).toHaveTextContent('Reviews so far: 640. At least 1000 are needed.')
  })

  it('is available online only', async () => {
    mockOptimize(200, {})
    setOnline(false)
    const button = await optimizeButton()
    expect(await screen.findAllByText('Available online')).not.toHaveLength(0)
    expect(button).toBeDisabled()
  })
})
