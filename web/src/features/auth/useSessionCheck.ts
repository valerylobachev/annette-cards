import { useEffect } from 'react'
import { me } from '@/api/endpoints/auth/auth'
import { callApi, isUnauthorized } from '@/lib/api'
import { getAccount, markSessionExpired, setAccount } from './account'

/**
 * On app start with a stored account and a connection: refreshes the account from `GET /api/auth/me` (which also
 * renews the session cookie). A 401 marks the session expired ("Sign in again"); local data stays untouched.
 */
export async function checkSession(): Promise<void> {
  if (!navigator.onLine || !(await getAccount())) return
  try {
    await setAccount(await callApi(() => me()))
  } catch (error) {
    if (isUnauthorized(error)) await markSessionExpired()
  }
}

export function useSessionCheck() {
  useEffect(() => {
    void checkSession()
  }, [])
}
