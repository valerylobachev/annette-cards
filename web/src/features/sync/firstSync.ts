import { logout } from '@/api/endpoints/auth/auth'
import { summary } from '@/api/endpoints/sync/sync'
import type { MeResponse, SummaryResponse } from '@/api/model'
import { enqueueAll, hasLocalData, localCounts, wipeLocalData } from '@/db/localData'
import { type AccountInfo, deleteMeta, getMeta, setMeta } from '@/db/meta'
import { callApi } from '@/lib/api'
import { getAccount, saveAccount } from '../auth/account'
import { syncNow, waitForIdle } from './engine'

export type Counts = { decks: number; cards: number }

/**
 * What to do after sign-in or registration (architecture.md §6.4, UC-04):
 * - `sync`: this device already synced with this account (e.g. signing in again after the session expired), or it
 *   has no local data: sync normally;
 * - `push`: local data and an empty account: send everything, then pull;
 * - `choose`: both have data: the user decides in S-03.
 */
export type FirstSyncPlan =
  | { kind: 'sync'; account: SummaryResponse | null }
  | { kind: 'push'; local: Counts; account: SummaryResponse }
  | { kind: 'choose'; local: Counts; account: SummaryResponse }

/**
 * Rows the first pull is expected to bring, for the progress bar: the account's decks and cards, about two states
 * per card, plus everything this device pushes (it comes back on pull). Reviews are not counted in the summary.
 */
export function expectedPullRows(account: SummaryResponse | null, pushed: number): number {
  return pushed + (account ? account.decks + account.cards * 3 : 0)
}

export function toAccountInfo(me: MeResponse): AccountInfo {
  return { user_id: me.id, email: me.email, display_name: me.display_name, is_admin: me.is_admin }
}

/** Remembers the signed-in account until the first-sync decision is made (the session cookie is already set). */
export async function beginFirstSync(me: MeResponse): Promise<void> {
  await setMeta('pending_account', toAccountInfo(me))
}

export async function getPendingAccount(): Promise<AccountInfo | null> {
  return (await getMeta('pending_account')) ?? null
}

export async function planFirstSync(pending: AccountInfo): Promise<FirstSyncPlan> {
  const previous = await getAccount()
  const synced = (await getMeta('sync_cursor')) !== undefined
  if (synced && previous?.user_id === pending.user_id) return { kind: 'sync', account: null }
  const account = await callApi(() => summary())
  if (!(await hasLocalData())) return { kind: 'sync', account }
  const local = await localCounts()
  return account.decks === 0 ? { kind: 'push', local, account } : { kind: 'choose', local, account }
}

/** Stores the account and runs the first sync; resolves when it finished (successfully or not). */
async function start(pending: AccountInfo): Promise<void> {
  await saveAccount(pending)
  await deleteMeta('pending_account')
  await syncNow('signin')
}

/**
 * `sync`: signing in again with the account this device synced with keeps everything. A device that never synced
 * with this account and has no decks starts from the account's data: leftovers (settings chosen during onboarding,
 * deleted rows) are dropped instead of overwriting the account's settings.
 */
export async function runPlannedSync(pending: AccountInfo, plan: FirstSyncPlan): Promise<void> {
  if (plan.kind === 'sync') {
    const previous = await getAccount()
    const sameAccount = previous?.user_id === pending.user_id && (await getMeta('sync_cursor')) !== undefined
    if (!sameAccount) await wipeLocalData()
  }
  if (plan.kind === 'push') await enqueueAll()
  await start(pending)
}

/** S-03 "Merge": every local row is pushed, then the account's rows are pulled; both sets end up on both sides. */
export async function mergeWithAccount(pending: AccountInfo): Promise<void> {
  await enqueueAll()
  await start(pending)
}

/** S-03 "Use account data": local data is removed (after the user confirmed), then the account is pulled. */
export async function replaceWithAccountData(pending: AccountInfo): Promise<void> {
  await waitForIdle()
  await wipeLocalData()
  await start(pending)
}

/** S-03 "Cancel": signs out again; local data stays untouched. */
export async function cancelFirstSync(): Promise<void> {
  await deleteMeta('pending_account')
  try {
    await callApi(() => logout())
  } catch {
    // Offline or already signed out: the session expires on its own.
  }
}
