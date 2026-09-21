import { Outlet, useMatches } from '@tanstack/react-router'
import { SnackbarProvider } from '@/components/Snackbar'
import { UpdateBanner } from '@/components/UpdateBanner'
import { TabBar } from './TabBar'

export function RootLayout() {
  // Study, import, editors, onboarding and auth are full-screen flows without the tab bar (ui_ux.md §3).
  const fullScreen = useMatches({ select: (matches) => matches.some((match) => match.staticData.fullScreen) })

  return (
    <SnackbarProvider aboveTabBar={!fullScreen}>
      <div className="min-h-dvh pl-safe pr-safe pt-safe">
        <UpdateBanner />
        <main className={fullScreen ? 'pb-safe' : 'pb-[calc(4rem+env(safe-area-inset-bottom))]'}>
          <Outlet />
        </main>
        {!fullScreen && <TabBar />}
      </div>
    </SnackbarProvider>
  )
}
