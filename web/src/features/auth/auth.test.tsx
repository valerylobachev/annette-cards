import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OfflineHint } from '@/components/OfflineHint'
import { createDeck } from '@/db/decks'
import { getMeta, setMeta } from '@/db/meta'
import { db } from '@/db/schema'
import i18n from '@/i18n'
import { ME, mockApi, sentBodies, setOnline } from '@/test/api'
import { resetDb } from '@/test/db'
import { renderApp } from '@/test/render'
import { checkSession } from './useSessionCheck'

beforeEach(async () => {
  await resetDb()
  await db.meta.put({ key: 'install_hint_shown', value: true })
})
afterEach(async () => {
  vi.unstubAllGlobals()
  setOnline(true)
  await act(() => i18n.changeLanguage('en'))
})

function signInButton() {
  return within(screen.getByRole('form', { name: 'Sign in' })).getByRole('button', { name: 'Sign in' })
}

async function signInAs(account = ME) {
  await setMeta('account', {
    user_id: account.id,
    email: account.email,
    display_name: account.display_name,
    is_admin: account.is_admin,
  })
}

describe('sign in (S-02)', () => {
  it('stores the account and opens Account & sync', async () => {
    const api = mockApi([{ method: 'POST', path: '/api/auth/login', body: ME }])
    const router = renderApp('/signin')
    await userEvent.type(await screen.findByLabelText('Email'), 'anna@example.com')
    await userEvent.type(screen.getByLabelText('Password'), 'correct horse battery')
    await userEvent.click(signInButton())

    await waitFor(() => expect(router.state.location.pathname).toBe('/settings/account'))
    expect(await screen.findByText('anna@example.com')).toBeInTheDocument()
    expect(await getMeta('account')).toEqual({
      user_id: 'user-1',
      email: 'anna@example.com',
      display_name: 'Anna',
      is_admin: false,
    })
    expect(sentBodies(api, '/api/auth/login')[0]).toMatchObject({
      email: 'anna@example.com',
      password: 'correct horse battery',
    })
  })

  it('shows invalid_credentials in English and Russian', async () => {
    mockApi([{ method: 'POST', path: '/api/auth/login', status: 401, body: { code: 'invalid_credentials' } }])
    renderApp('/signin')
    await userEvent.type(await screen.findByLabelText('Email'), 'anna@example.com')
    await userEvent.type(screen.getByLabelText('Password'), 'wrong password')
    await userEvent.click(signInButton())
    expect(await screen.findByRole('alert')).toHaveTextContent('Wrong email or password.')

    await act(() => i18n.changeLanguage('ru'))
    await userEvent.click(within(screen.getByRole('form', { name: 'Вход' })).getByRole('button', { name: 'Войти' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Неверная почта или пароль.')
    expect(await getMeta('account')).toBeUndefined()
  })

  it('disables the form offline', async () => {
    setOnline(false)
    renderApp('/signin')
    expect(await screen.findByText('Connect to the internet to sign in.')).toBeInTheDocument()
    expect(screen.getByLabelText('Email')).toBeDisabled()
    expect(signInButton()).toBeDisabled()
  })
})

describe('register (S-02)', () => {
  it('prefills the invite code from the link and reports an expired invite', async () => {
    const api = mockApi([{ method: 'POST', path: '/api/auth/register', status: 400, body: { code: 'invite_expired' } }])
    renderApp('/register?invite=ABCD2345EFGH')
    expect(await screen.findByLabelText('Invite code')).toHaveValue('ABCD2345EFGH')
    await userEvent.type(screen.getByLabelText('Your name'), 'Anna')
    await userEvent.type(screen.getByLabelText('Email'), 'anna@example.com')
    const create = screen.getByRole('button', { name: 'Create account' })
    await userEvent.type(screen.getByLabelText('Password'), 'short')
    expect(screen.getByText('At least 10 characters')).toBeInTheDocument()
    expect(create).toBeDisabled()
    await userEvent.type(screen.getByLabelText('Password'), ' but long')
    await userEvent.click(create)

    expect(await screen.findByRole('alert')).toHaveTextContent('This invite has expired. Ask for a new one.')
    expect(sentBodies(api, '/api/auth/register')[0]).toMatchObject({
      invite_code: 'ABCD2345EFGH',
      display_name: 'Anna',
      password: 'short but long',
    })
  })

  it('switches between sign-in and registration', async () => {
    const router = renderApp('/signin?invite=CODE')
    await userEvent.click(await screen.findByRole('button', { name: 'Register' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/register'))
    expect(await screen.findByLabelText('Invite code')).toHaveValue('CODE')
  })
})

describe('Account & sync (S-15)', () => {
  it('invites to sign in when signed out', async () => {
    renderApp('/settings/account')
    expect(await screen.findByText(/Sign in to back up and sync/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/signin')
  })

  it('hides invites from users who are not admins', async () => {
    await signInAs()
    const api = mockApi([])
    renderApp('/settings/account')
    expect(await screen.findByText('anna@example.com')).toBeInTheDocument()
    expect(screen.queryByText('Invites')).not.toBeInTheDocument()
    expect(api).not.toHaveBeenCalledWith(expect.stringContaining('/api/admin'), expect.anything())
  })

  it('lets an admin create an invite, see its link and revoke an active one', async () => {
    await signInAs({ ...ME, is_admin: true })
    const invite = { code: 'NEWCODE23456', note: 'Bob', expires_at: Date.now() + 7 * 86_400_000, status: 'active' }
    const api = mockApi([
      {
        path: '/api/admin/invites',
        body: [
          { ...invite, code: 'ACTIVE234567', note: 'Anna', used_by_email: null, used_at: null },
          { ...invite, code: 'USED23456789', note: null, status: 'used', used_by_email: 'x@y.z', used_at: 1 },
        ],
      },
      {
        method: 'POST',
        path: '/api/admin/invites',
        status: 201,
        body: { ...invite, used_by_email: null, used_at: null },
      },
      { method: 'DELETE', path: '/api/admin/invites/ACTIVE234567', status: 204 },
    ])
    renderApp('/settings/account')
    const list = await screen.findByRole('list', { name: 'Invites' })
    expect(within(list).getByText('Active')).toBeInTheDocument()
    expect(within(list).getByText('Used by x@y.z')).toBeInTheDocument()
    expect(within(list).getAllByRole('button', { name: /Revoke invite/ })).toHaveLength(1)

    await userEvent.click(screen.getByRole('button', { name: 'Create invite' }))
    await userEvent.type(await screen.findByLabelText('Who is it for? (optional)'), 'Bob')
    await userEvent.click(screen.getByRole('button', { name: 'Create' }))
    const link = await screen.findByLabelText('Invite link')
    expect(link).toHaveTextContent(`${window.location.origin}/register?invite=NEWCODE23456`)
    expect(sentBodies(api, '/api/admin/invites')).toContainEqual({ note: 'Bob', days: 7 })
    await userEvent.keyboard('{Escape}')

    await userEvent.click(await screen.findByRole('button', { name: 'Revoke invite ACTIVE234567' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Revoke' }))
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith(
        '/api/admin/invites/ACTIVE234567',
        expect.objectContaining({ method: 'DELETE' }),
      ),
    )
  })

  it('marks the session expired on 401 from me and keeps local data', async () => {
    await signInAs()
    await createDeck({
      name: 'English',
      target_lang: 'en-GB',
      native_lang: 'ru',
      directions: 'both',
      new_per_day: null,
    })
    mockApi([{ path: '/api/auth/me', status: 401, body: { code: 'unauthorized' } }])
    await checkSession()
    expect(await getMeta('session_expired')).toBe(true)
    expect(await db.decks.count()).toBe(1)

    renderApp('/settings/account')
    expect(await screen.findByRole('alert')).toHaveTextContent('Your session has ended')
    expect(screen.getByRole('link', { name: 'Sign in again' })).toBeInTheDocument()
  })

  it('refreshes the stored account from me', async () => {
    await signInAs()
    await setMeta('session_expired', true)
    mockApi([{ path: '/api/auth/me', body: { ...ME, display_name: 'Anna K.' } }])
    await checkSession()
    expect((await getMeta('account'))?.display_name).toBe('Anna K.')
    expect(await getMeta('session_expired')).toBeUndefined()
  })
})

describe('OfflineHint', () => {
  it('disables the action and explains why when offline', async () => {
    render(
      <OfflineHint>
        {(offline) => (
          <button type="button" disabled={offline}>
            Create invite
          </button>
        )}
      </OfflineHint>,
    )
    expect(screen.getByRole('button')).toBeEnabled()
    act(() => setOnline(false))
    expect(screen.getByRole('button')).toBeDisabled()
    expect(screen.getByText('Available online')).toBeInTheDocument()
  })
})

describe('onboarding', () => {
  it('offers "I have an account" when signed out', async () => {
    renderApp('/welcome')
    expect(await screen.findByRole('link', { name: 'I have an account' })).toHaveAttribute('href', '/signin')
  })
})
