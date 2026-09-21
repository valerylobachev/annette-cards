import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getMeta } from '@/db/meta'
import { db } from '@/db/schema'
import { getSettings } from '@/db/settings'
import i18n from '@/i18n'
import { download } from '@/lib/audio/audioCache'
import { clipResponse, installFakeCaches } from '@/test/caches'
import { resetDb } from '@/test/db'
import { renderApp } from '@/test/render'

const platform = vi.hoisted(() => ({ ios: true, standalone: false }))
vi.mock('@/lib/platform', () => ({ isIosSafari: () => platform.ios, isStandalone: () => platform.standalone }))

beforeEach(resetDb)
afterEach(async () => {
  await act(() => i18n.changeLanguage('en'))
  platform.ios = true
  platform.standalone = false
})

describe('settings', () => {
  it('switches the UI language at once and stores it in the settings document', async () => {
    await db.meta.put({ key: 'install_hint_shown', value: true })
    renderApp('/settings')
    await userEvent.click(await screen.findByRole('button', { name: 'Русский' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Настройки' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Сегодня' })).toBeInTheDocument()
    await waitFor(async () => expect((await getSettings()).ui_language).toBe('ru'))

    await userEvent.click(screen.getByRole('button', { name: 'English' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument()
  })

  it('saves study settings through the settings document', async () => {
    await db.meta.put({ key: 'install_hint_shown', value: true })
    renderApp('/settings')
    await userEvent.selectOptions(await screen.findByLabelText('New words per day'), '25')
    await userEvent.click(screen.getByRole('button', { name: 'Detailed (4 buttons)' }))
    await waitFor(async () => expect(await getSettings()).toMatchObject({ new_per_day: 25, answer_mode: 'detailed' }))
  })
})

describe('audio storage', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows storage usage and cached clips, lists recording attributions and clears the audio', async () => {
    await db.meta.put({ key: 'install_hint_shown', value: true })
    installFakeCaches()
    vi.stubGlobal('fetch', async (url: string) =>
      url.endsWith('/r1') ? clipResponse('commons', 'Derbeth · CC BY 2.5') : clipResponse('azure'),
    )
    await download('r1')
    await download('t1')
    Object.defineProperty(navigator, 'storage', {
      value: { estimate: async () => ({ usage: 12_500_000, quota: 2_000_000_000 }) },
      configurable: true,
    })
    renderApp('/settings')
    expect(await screen.findByText('12.5 MB of 2 GB')).toBeInTheDocument()
    expect(await screen.findByText('2 audio clips saved')).toBeInTheDocument()
    expect(screen.getByText('Derbeth · CC BY 2.5')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Clear cached audio' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Clear cached audio' }))
    expect(await screen.findByText('0 audio clips saved')).toBeInTheDocument()
    expect(screen.getByText('No recordings saved on this device.')).toBeInTheDocument()
  })

  it('turns the audio prefetch on for this device', async () => {
    await db.meta.put({ key: 'install_hint_shown', value: true })
    renderApp('/settings')
    await userEvent.click(await screen.findByRole('switch', { name: 'Download audio for offline' }))
    await waitFor(async () => expect(await getMeta('audio_prefetch')).toBe(true))
  })
})

describe('install hint', () => {
  it('shows once in iOS Safari outside the Home Screen app', async () => {
    renderApp('/decks')
    expect(await screen.findByText('Install Annette on your iPhone')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Got it' }))
    await waitFor(async () => expect((await db.meta.get('install_hint_shown'))?.value).toBe(true))
  })

  it('does not show in the installed app or after it was closed', async () => {
    platform.standalone = true
    renderApp('/decks')
    await screen.findByRole('heading', { level: 1 })
    expect(screen.queryByText('Install Annette on your iPhone')).not.toBeInTheDocument()
  })
})
