import { Outlet, useMatches } from '@tanstack/react-router'
import { AutoInstallHint } from '@/components/InstallHint'
import { SnackbarProvider } from '@/components/Snackbar'
import { UpdateBanner } from '@/components/UpdateBanner'
import { SpeechProvider } from '@/lib/speech/useSpeech'
import { TabBar } from './TabBar'
import { useAppPreferences } from './useAppPreferences'

export function RootLayout() {
  // Study, import, editors, onboarding and auth are full-screen flows without the tab bar (ui_ux.md §3).
  const fullScreen = useMatches({ select: (matches) => matches.some((match) => match.staticData.fullScreen) })
  useAppPreferences()

  return (
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
  )
}
