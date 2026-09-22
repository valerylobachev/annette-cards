import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Outlet, useMatches } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { AutoInstallHint } from '@/components/InstallHint'
import { SnackbarProvider } from '@/components/Snackbar'
import { UpdateBanner } from '@/components/UpdateBanner'
import { useSessionCheck } from '@/features/auth/useSessionCheck'
import { onSyncFinished } from '@/features/sync/engine'
import { startSyncTriggers } from '@/features/sync/triggers'
import { prefetchAudio } from '@/lib/audio/prefetch'
import { SpeechProvider } from '@/lib/speech/useSpeech'
import { TabBar } from './TabBar'
import { useAppPreferences } from './useAppPreferences'
import { useNotificationTaps } from './useNotificationTaps'

export function RootLayout() {
  // Study, import, editors, onboarding and auth are full-screen flows without the tab bar (ui_ux.md §3).
  const fullScreen = useMatches({ select: (matches) => matches.some((match) => match.staticData.fullScreen) })
  useAppPreferences()
  useSessionCheck()
  useNotificationTaps()
  useEffect(() => startSyncTriggers(), [])
  useEffect(() => onSyncFinished(() => void prefetchAudio()), [])
  // Server calls outside sync (invites, server version) go through TanStack Query; nothing is retried offline.
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }))

  return (
    <QueryClientProvider client={queryClient}>
      <SpeechProvider>
        <SnackbarProvider aboveTabBar={!fullScreen}>
          <div className="min-h-dvh pl-safe pr-safe pt-safe">
            <UpdateBanner />
            <main className={fullScreen ? 'pb-safe' : 'pb-[calc(4rem+env(safe-area-inset-bottom))]'}>
              <Outlet />
            </main>
            {!fullScreen && <TabBar />}
            {!fullScreen && <AutoInstallHint />}
          </div>
        </SnackbarProvider>
      </SpeechProvider>
    </QueryClientProvider>
  )
}
