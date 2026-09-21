import { createRootRoute, createRoute, createRouter, type RouterHistory } from '@tanstack/react-router'
import { RegisterPage, SignInPage, WelcomePage } from '@/features/auth/pages'
import { CardEditPage, CardNewPage, CardViewPage } from '@/features/cards/pages'
import { DeckDetailPage, DecksPage } from '@/features/decks/pages'
import { ImportPage } from '@/features/import/pages'
import { AccountPage, SettingsPage, VoicesPage } from '@/features/settings/pages'
import { StatsPage } from '@/features/stats/pages'
import { StudyPage, SummaryPage } from '@/features/study/pages'
import { FirstSyncPage } from '@/features/sync/pages'
import { TodayPage } from '@/features/today/pages'
import { RootLayout } from './RootLayout'
import { parseAuthSearch, parseCardNewSearch, parseImportSearch, parseStudySearch } from './search'

declare module '@tanstack/react-router' {
  interface Register {
    router: AppRouter
  }
  interface StaticDataRouteOption {
    /** Full-screen flow: the bottom tab bar is hidden. */
    fullScreen?: boolean
  }
}

const rootRoute = createRootRoute({ component: RootLayout })
const fullScreen = { fullScreen: true }

// Screen ids (S-xx) refer to docs/ui_ux.md §5.
const routes = [
  createRoute({ getParentRoute: () => rootRoute, path: '/', component: TodayPage }), // S-04
  createRoute({ getParentRoute: () => rootRoute, path: '/decks', component: DecksPage }), // S-05
  createRoute({ getParentRoute: () => rootRoute, path: '/decks/$deckId', component: DeckDetailPage }), // S-06
  createRoute({ getParentRoute: () => rootRoute, path: '/cards/$cardId', component: CardViewPage }), // S-07
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/cards/new',
    component: CardNewPage,
    staticData: fullScreen,
    validateSearch: parseCardNewSearch,
  }), // S-08
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/cards/$cardId/edit',
    component: CardEditPage,
    staticData: fullScreen,
  }), // S-08
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/import',
    component: ImportPage,
    staticData: fullScreen,
    validateSearch: parseImportSearch,
  }), // S-10
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/study',
    component: StudyPage,
    staticData: fullScreen,
    validateSearch: parseStudySearch,
  }), // S-11
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/study/summary',
    component: SummaryPage,
    staticData: fullScreen,
  }), // S-12
  createRoute({ getParentRoute: () => rootRoute, path: '/stats', component: StatsPage }), // S-13
  createRoute({ getParentRoute: () => rootRoute, path: '/settings', component: SettingsPage }), // S-14
  createRoute({ getParentRoute: () => rootRoute, path: '/settings/account', component: AccountPage }), // S-15
  createRoute({ getParentRoute: () => rootRoute, path: '/settings/voices', component: VoicesPage }), // S-16
  createRoute({ getParentRoute: () => rootRoute, path: '/welcome', component: WelcomePage, staticData: fullScreen }), // S-01
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/signin',
    component: SignInPage,
    staticData: fullScreen,
    validateSearch: parseAuthSearch,
  }), // S-02
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/register',
    component: RegisterPage,
    staticData: fullScreen,
    validateSearch: parseAuthSearch,
  }), // S-02
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/first-sync',
    component: FirstSyncPage,
    staticData: fullScreen,
  }), // S-03
] as const

const routeTree = rootRoute.addChildren(routes)

export function createAppRouter(history?: RouterHistory) {
  return createRouter({ routeTree, history, defaultPreload: 'intent', scrollRestoration: true })
}

export type AppRouter = ReturnType<typeof createAppRouter>
