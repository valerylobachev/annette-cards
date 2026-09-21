# P0-T02 — Web skeleton

## Context

P0-T01 created the repository structure, the `justfile` and CI workflows. `web/` is still empty. This task
creates the React PWA shell: routing for every screen as placeholders, the bottom tab bar, i18n in RU/EN,
PWA manifest and update prompt, and the test/lint toolchain. All later client tasks build on this shell.
The server does not exist yet (P0-T03); only the Vite proxy is configured for it.

## Read first

- `CLAUDE.md` (always) — Repository layout (`web/src/*`), TypeScript conventions, iOS/Safari gotchas
- `docs/tech_stack.md` → Client: React 19, Vite, pnpm, TanStack Router, Tailwind 4, shadcn/ui, lucide-react,
  i18next, Biome, Vitest, Testing Library, Playwright, `vite-plugin-pwa`
- `docs/architecture.md` §4.1 (layers), §4.6 (i18n), §4.7 (PWA)
- `docs/ui_ux.md` §1–§3 (principles, visual language, navigation, deep links), §4 (Update banner), §5 screen
  list S-01…S-16, §9 (localization)

## Scope

From `docs/plan.md` (Phase 0 · Web skeleton):

- [ ] Vite + React 19 + TypeScript (strict) with pnpm
- [ ] Tailwind 4, shadcn/ui init, lucide-react, dark mode via system preference
- [ ] TanStack Router with routes for all screens (placeholder pages) and bottom tab bar layout
- [ ] i18next with `en.json`/`ru.json`, language detection, one translated string per screen
- [ ] Biome config; Vitest + Testing Library; Playwright with WebKit and Chromium projects
- [ ] `vite-plugin-pwa`: manifest, icons (incl. maskable, apple-touch-icon), iOS meta tags, update prompt banner
- [ ] Vite proxy `/api` → `127.0.0.1:8080`

## Out of scope

- Dexie, repositories, domain types (P1-T01).
- Real screen content; placeholders only (Phase 1 tasks).
- Theme override in Settings (P1-T12) — this task only follows `prefers-color-scheme`.
- UI language persisted in settings (P1-T12) — this task only detects and allows switching at runtime.
- orval client generation (`just gen-api` is wired in P0-T03; install `orval` here as a dev dependency and add
  `orval.config.ts` so the recipe works once `openapi.json` exists).
- Audio runtime caching (P3-T03), install hint (P1-T12), offline E2E (P1-T13).

## Implementation steps

1. Scaffold in `web/` with pnpm: Vite `react-ts` template, React 19, `"strict": true` plus
   `noUncheckedIndexedAccess`; path alias `@/` → `src/`. Create folders from CLAUDE.md:
   `src/app`, `src/features/{today,decks,cards,import,study,stats,settings,auth,sync}`, `src/domain`,
   `src/db`, `src/api`, `src/i18n`, `src/components`, `src/lib`, `tests/e2e`. Remove `web/.gitkeep`.
   → verify: `pnpm tsc --noEmit` passes.
2. Tailwind 4 via `@tailwindcss/vite`; `shadcn` init (components in `src/components/ui`); `lucide-react`.
   Dark mode follows `prefers-color-scheme` (Tailwind `dark:` variant with media strategy; leave a
   `data-theme` hook so P1-T12 can add a manual override). Base CSS: system font stack, inputs ≥ 16 px,
   `viewport-fit=cover`, safe-area padding utilities using `env(safe-area-inset-*)`.
   → verify: a shadcn `Button` renders in both schemes in the dev server.
3. TanStack Router (file-based or code-based — pick one, document it in `docs/tech_stack.md`). Routes:
   `/` Today (S-04), `/decks` (S-05), `/decks/$deckId` (S-06), `/cards/$cardId` (S-07),
   `/cards/new` and `/cards/$cardId/edit` (S-08), `/import` (S-10), `/study` with search params
   `deck`, `mode` (S-11), `/study/summary` (S-12), `/stats` (S-13), `/settings` (S-14),
   `/settings/account` (S-15), `/settings/voices` (S-16), `/welcome` (S-01), `/signin` and
   `/register` with optional `invite` search param (S-02), `/first-sync` (S-03). Quick add (S-09) is a sheet,
   not a route. Layout in `src/app/`: bottom tab bar with four tabs (Today, Decks, Statistics, Settings) using
   lucide icons; tab bar hidden on full-screen routes (study, import, editors, onboarding, auth).
   → verify: navigating to each path renders its placeholder; browser back works.
4. i18next + react-i18next + `i18next-browser-languagedetector` in `src/i18n/`. Resources `en.json`, `ru.json`
   with namespaced keys (`nav.*`, `screens.<screen>.title`, `update.*`). Detection order: stored value, then
   `navigator.language` starting with `ru` → `ru`, else `en` (architecture §4.6). Russian plural suffixes work
   (`_one/_few/_many/_other`) — add one plural key as an example. A temporary language toggle on the Settings
   placeholder lets the E2E test switch languages. Every placeholder shows one translated title.
   → verify: switching language re-renders all visible text.
5. Tooling: `biome.json` (formatter + linter, ignore `src/api/**`, `dist`, `dev-dist`); Vitest with `jsdom`,
   Testing Library, `@testing-library/jest-dom` setup file; `playwright.config.ts` with projects `webkit`
   (mandatory) and `chromium`, `webServer` running `pnpm dev` (or `preview`), base URL `http://localhost:5173`.
   `package.json` scripts: `dev`, `build`, `preview`, `test`, `e2e`, `lint`, `typecheck`.
   → verify: `pnpm biome check`, `pnpm vitest run`, `pnpm playwright test --project=webkit` run.
6. `vite-plugin-pwa` with `registerType: 'prompt'`: manifest (`name` "Annette Cards", `short_name`,
   `display: standalone`, `start_url: /`, light/dark `theme_color`, icons 192/512, a maskable 512 icon);
   `public/apple-touch-icon.png` (180×180); iOS meta tags in `index.html`
   (`apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style`, `apple-touch-icon`). Workbox:
   precache the app shell; `navigateFallbackDenylist: [/^\/api\//]`; `/api/*` NetworkOnly. Update banner
   component in `src/components/UpdateBanner.tsx` using `useRegisterSW` — text "A new version is available ·
   Reload" from i18n. Placeholder icons can be simple generated PNGs.
   → verify: `pnpm build && pnpm preview` — Lighthouse/DevTools shows a valid manifest and a registered SW.
7. `vite.config.ts` dev server proxy: `/api` → `http://127.0.0.1:8080`. HTTPS mode for `just dev-https`:
   enable `@vitejs/plugin-basic-ssl` (or mkcert certs) when `VITE_HTTPS=1`, host `0.0.0.0`.
   → verify: `curl -i localhost:5173/api/health` is proxied (502/connection error until P0-T03 is done, not
   `index.html`).

## Tests

- Vitest: `App` renders the tab bar with four tabs; i18n switches "Today" ↔ "Сегодня"; Russian plural helper
  returns correct forms for 1, 2, 5.
- Playwright (WebKit + Chromium) `tests/e2e/shell.spec.ts`: app loads, all four tabs navigate, study route hides
  the tab bar, switching language to RU shows Russian tab labels.

## Invariants to respect

- No hardcoded UI strings — every visible text via i18n with keys in both `en.json` and `ru.json`.
- Never edit `src/api/` by hand (it stays empty until `just gen-api`).
- Mobile-first; respect iOS safe areas; inputs ≥ 16 px.

## Docs to update

- `docs/tech_stack.md` → record the router style (file-based vs code-based) and any added dev dependency
  (`i18next-browser-languagedetector`, `@vitejs/plugin-basic-ssl`).
- `docs/ui_ux.md` §3 → list the actual route paths if they differ from the deep links shown.
- `CLAUDE.md` → only if the `web/` layout differs from the documented tree.
- `docs/plan.md` → tick the seven Web skeleton checkboxes.

## Definition of done

- [ ] All scope items implemented
- [ ] Tests written and passing: `pnpm vitest run` and `just e2e` (WebKit mandatory); `cargo` parts of
      `just test` run once P0-T03 exists
- [ ] Web half of `just lint` clean (`pnpm biome check`, `pnpm tsc --noEmit`)
- [ ] App shell loads from the service worker after one online visit (DevTools offline) in WebKit
- [ ] Docs updated as listed above; plan.md checkboxes ticked
- [ ] Committed: `feat(web): add PWA skeleton with router, i18n and tooling`

## If unclear

If anything in this task is ambiguous or conflicts with the docs, stop and ask before implementing.
