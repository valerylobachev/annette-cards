import { useRouterState } from '@tanstack/react-router'
import { useEffect } from 'react'
import { useMeta, useStoredUiLanguage } from '@/db/hooks'
import i18n from '@/i18n'
import { requestPersistence } from '@/lib/storage'
import { applyTheme } from '@/lib/theme'

/**
 * App-wide preferences applied on start and whenever they change (also when a sync brings another device's
 * choice): theme (`meta.theme`), UI language (settings document, architecture.md §4.6) and the storage
 * persistence request on first run (§4.7). During onboarding the request waits for its last step (S-01).
 */
export function useAppPreferences() {
  const theme = useMeta('theme')
  const uiLanguage = useStoredUiLanguage()
  const persisted = useMeta('storage_persisted')
  const onboarding = useRouterState({ select: (state) => state.location.pathname === '/welcome' })

  useEffect(() => {
    if (theme !== undefined) applyTheme(theme ?? 'system')
  }, [theme])

  useEffect(() => {
    if (uiLanguage && uiLanguage !== i18n.resolvedLanguage) void i18n.changeLanguage(uiLanguage)
  }, [uiLanguage])

  useEffect(() => {
    if (persisted === null && !onboarding) void requestPersistence()
  }, [persisted, onboarding])
}
