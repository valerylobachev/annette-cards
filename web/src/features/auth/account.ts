import { useLiveQuery } from 'dexie-react-hooks'
import type { MeResponse } from '@/api/model'
import { type AccountInfo, deleteMeta, getMeta, setMeta } from '@/db/meta'
import { db } from '@/db/schema'

export type { AccountInfo }

/** The signed-in account of this device (`meta.account`); device-local, never synced. */
export async function getAccount(): Promise<AccountInfo | null> {
  return (await getMeta('account')) ?? null
}

/** Stores the account after sign-in, registration or a successful `me`, and clears a session-expired mark. */
export async function setAccount(me: MeResponse): Promise<AccountInfo> {
  return saveAccount({ user_id: me.id, email: me.email, display_name: me.display_name, is_admin: me.is_admin })
}

export async function saveAccount(account: AccountInfo): Promise<AccountInfo> {
  await db.transaction('rw', db.meta, async () => {
    await setMeta('account', account)
    await deleteMeta('session_expired')
  })
  return account
}

export async function clearAccount(): Promise<void> {
  await db.transaction('rw', db.meta, async () => {
    await deleteMeta('account')
    await deleteMeta('session_expired')
  })
}

export async function markSessionExpired(): Promise<void> {
  await setMeta('session_expired', true)
}

export type AccountState = { account: AccountInfo | null; sessionExpired: boolean }

/** `undefined` while loading. */
export function useAccount(): AccountState | undefined {
  return useLiveQuery(async () => ({
    account: (await getMeta('account')) ?? null,
    sessionExpired: (await getMeta('session_expired')) === true,
  }))
}
