import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setMeta } from '@/db/meta'
import { getSettings, updateSettings } from '@/db/settings'
import { mockApi, sentBodies, setOnline } from '@/test/api'
import { resetDb } from '@/test/db'
import { renderApp } from '@/test/render'

const platform = vi.hoisted(() => ({ standalone: true }))
vi.mock('@/lib/platform', () => ({ isIosSafari: () => true, isStandalone: () => platform.standalone }))

const VAPID = 'BOybS5X7a6I4xgXcfKoeQFoAJLi1DbYqUsLUi_RC5Vol7Wry68XfmT8fPAEo4bMabxjLF7OhKq5VchiAM42gd2Q'
const ENDPOINT = 'https://web.push.apple.com/device-1'

type FakeSubscription = { endpoint: string; unsubscribe: ReturnType<typeof vi.fn> }

/** A browser with Push: `Notification`, `PushManager` and a service worker registration, all fake. */
function installPush(permission: NotificationPermission, existing = false) {
  const keyBytes = Uint8Array.from(atob(`${VAPID.replaceAll('-', '+').replaceAll('_', '/')}=`), (c) => c.charCodeAt(0))
  const make = (): FakeSubscription & Record<string, unknown> => ({
    endpoint: ENDPOINT,
    options: { applicationServerKey: keyBytes.buffer },
    toJSON: () => ({ endpoint: ENDPOINT, expirationTime: null, keys: { p256dh: 'p256dh-key', auth: 'auth-key' } }),
    unsubscribe: vi.fn(async () => true),
  })
  const state = { subscription: existing ? make() : null }
  const pushManager = {
    getSubscription: vi.fn(async () => state.subscription),
    subscribe: vi.fn(async () => {
      state.subscription = make()
      return state.subscription
    }),
  }
  const requestPermission = vi.fn(async () => permission)
  vi.stubGlobal('Notification', { permission: 'default', requestPermission })
  vi.stubGlobal('PushManager', class {})
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      getRegistration: async () => ({ pushManager }),
      addEventListener: () => {},
      removeEventListener: () => {},
    },
  })
  return { state, pushManager, requestPermission }
}

function mockServer() {
  return mockApi([
    {
      path: '/api/meta',
      body: {
        version: '0.1.0',
        features: { tts: false, commons: false, enrich: false, push: true },
        vapid_public_key: VAPID,
      },
    },
    { method: 'POST', path: '/api/push/subscribe', status: 204 },
    { method: 'DELETE', path: '/api/push/subscribe', status: 204 },
  ])
}

async function openSettings() {
  renderApp('/settings')
  return screen.findByRole('switch', { name: 'Daily reminder' })
}

beforeEach(async () => {
  await resetDb()
  await setMeta('install_hint_shown', true)
  await setMeta('server_features', { tts: false, commons: false, enrich: false, push: true })
  await setMeta('account', { user_id: 'u1', email: 'anna@example.com', display_name: 'Anna', is_admin: false })
})

afterEach(() => {
  vi.unstubAllGlobals()
  Reflect.deleteProperty(navigator, 'serviceWorker')
  setOnline(true)
  platform.standalone = true
})

describe('Reminders', () => {
  it('asks for permission, stores the subscription and turns the reminder on', async () => {
    const api = mockServer()
    const push = installPush('granted')
    const toggle = await openSettings()
    await waitFor(() => expect(toggle).toBeEnabled())

    await userEvent.click(toggle)
    await waitFor(() => expect(toggle).toBeChecked())
    expect(push.requestPermission).toHaveBeenCalled()
    expect(push.pushManager.subscribe).toHaveBeenCalledWith(expect.objectContaining({ userVisibleOnly: true }))
    expect(sentBodies(api, '/api/push/subscribe')).toEqual([
      { endpoint: ENDPOINT, keys: { p256dh: 'p256dh-key', auth: 'auth-key' } },
    ])
    expect((await getSettings()).reminder).toEqual({ enabled: true, time: '20:00', tz: 'Europe/Riga' })

    fireEvent.change(screen.getByLabelText('Time'), { target: { value: '08:30' } })
    await waitFor(async () => expect((await getSettings()).reminder.time).toBe('08:30'))
  })

  it('keeps the reminder off with an explanation when notifications are denied', async () => {
    const api = mockServer()
    installPush('denied')
    const toggle = await openSettings()
    await waitFor(() => expect(toggle).toBeEnabled())

    await userEvent.click(toggle)
    expect(await screen.findByRole('alert')).toHaveTextContent('Notifications are turned off for Annette')
    expect(toggle).not.toBeChecked()
    expect(sentBodies(api, '/api/push/subscribe')).toEqual([])
    expect((await getSettings()).reminder.enabled).toBe(false)
  })

  it('turns the reminder off and removes the subscription', async () => {
    const api = mockServer()
    const push = installPush('granted', true)
    await updateSettings({ reminder: { enabled: true, time: '20:00', tz: 'Europe/Riga' } })
    const toggle = await openSettings()
    await waitFor(() => expect(toggle).toBeChecked())

    await userEvent.click(toggle)
    await waitFor(() => expect(toggle).not.toBeChecked())
    expect(sentBodies(api, '/api/push/subscribe')).toEqual([{ endpoint: ENDPOINT }])
    expect(push.state.subscription?.unsubscribe).toHaveBeenCalled()
    expect((await getSettings()).reminder.enabled).toBe(false)
  })

  it('explains that reminders need the installed app', async () => {
    mockServer()
    installPush('granted')
    platform.standalone = false
    const toggle = await openSettings()
    expect(screen.getByText(/Install the app to get reminders/)).toBeInTheDocument()
    expect(toggle).toBeDisabled()
  })

  it('is available online only', async () => {
    mockServer()
    installPush('granted')
    setOnline(false)
    const toggle = await openSettings()
    const row = toggle.parentElement as HTMLElement
    expect(await within(row).findByText('Available online')).toBeInTheDocument()
    expect(toggle).toBeDisabled()
  })
})
