# P1-T13 — Onboarding and offline

## Context

Every Phase 1 screen exists (P1-T01…P1-T12). A brand-new user, however, lands on an empty Today with no
guidance, and full offline behavior has never been verified end to end. This task builds the first-run
onboarding (S-01): UI language, studied/native languages, daily goal, first deck, install hint and persistence
request. It then verifies offline operation: app-shell precache and an airplane-mode Playwright test.

## Read first

- `CLAUDE.md` (always) — "iOS / Safari gotchas", definition of done
- `docs/architecture.md` §4.6 (initial language), §4.7 (PWA: precache, `/api/*` NetworkOnly, storage)
- `docs/ui_ux.md` S-01, §1 principle 4 ("Offline is normal")
- `docs/use_cases.md` UC-01 (incl. 2a, 3a), UC-18, UC-26
- `docs/tech_stack.md` → `vite-plugin-pwa` (Workbox), Playwright

## Scope

From `docs/plan.md` §1.7:

- [ ] Onboarding (S-01) including language, daily goal, first deck, persistence request
- [ ] Offline verification: app shell precache, airplane-mode E2E test (Playwright offline context)

## Out of scope

- "I have an account" sign-in (P2-T05). In Phase 1 the button is hidden (server features do not exist yet);
  P2-T05 adds it.
- Voice download guide content (exists in P1-T11; link to it).

## Implementation steps

1. First-run detection `web/src/features/onboarding/useFirstRun.ts`: onboarding is needed when there are no
   decks (including soft-deleted) and `meta.onboarding_done` is not set. Router guard: redirect `/` to
   `/welcome` in that case; never redirect deep links to `/study` or `/import` started from onboarding.
2. `web/src/features/onboarding/OnboardingPage.tsx`: horizontal pager with dots and Next/Back:
   1) **Welcome** — app name, value proposition, RU/EN switch (writes `ui_language`), "Get started";
   2) **Languages** — "I'm learning": searchable list via `Intl.DisplayNames`, EN and PL pinned with variant
      chips (en-GB / en-US / pl-PL); "Voice available" markers from `hasVoice` (spinner while voices load);
      no voice → warning with link to the Voices guide (UC-01 3a), onboarding continues; "My language"
      default Russian;
   3) **Daily goal** — 5 / 10 / 15 / 25 / custom (default 15) → `settings.new_per_day`; two-sentence spaced
      repetition explanation;
   4) **First deck** — "Import a file" (creates the deck, then `/import?deck=<id>`), "Add words manually"
      (`/cards/new?deck=<id>`), "Start with an empty deck"; deck name defaults to the language name;
      directions from `settings.default_directions`;
   5) **Install & persist** — shown only on iOS Safari not in standalone: install hint (reuse
      `InstallHint` content) and "Continue" which calls `requestPersistence()`; on other platforms
      `requestPersistence()` runs on finishing step 4.
3. Finishing writes settings (stamped + outbox) and the deck in repositories, sets `meta.onboarding_done`,
   and navigates to Today (or the chosen import/editor route).
4. Offline: review `vite-plugin-pwa` config from Phase 0 — precache app shell (HTML, JS, CSS, fonts, icons,
   worker chunks incl. the import worker), `navigateFallback: '/index.html'`, `/api/*` NetworkOnly. Make sure
   lazily loaded route chunks are precached.
5. Playwright E2E `web/tests/e2e/offline.spec.ts` (WebKit project; Chromium too): load online, wait for the
   service worker to control the page, `context.setOffline(true)`, reload → app renders; create deck, add a
   card, study it, reload → progress intact.
6. Playwright E2E `web/tests/e2e/onboarding.spec.ts`: full onboarding in EN and RU → Today shows the new deck.
7. i18n keys under `onboarding.*`.

## Tests

- Vitest: `useFirstRun` → true on empty DB; false when a soft-deleted deck exists (not a new user) or
  `onboarding_done` is set.
- Testing Library: goal "custom" accepts 1–200; Next disabled without a studied language.
- Playwright (WebKit): onboarding → "Import a file" lands on the import wizard with the new deck preselected.
- Playwright (WebKit): offline spec as in step 5, including a hard reload while offline.
- Playwright: onboarding with `navigator.language = 'ru-RU'` starts in Russian.

## Invariants to respect

- Offline-first: onboarding makes no network calls.
- All writes via repositories (stamp + outbox); `meta` for device-only flags.
- `navigator.storage.persist()` requested on first run.
- No hardcoded strings.

## Rust learning notes

n/a (web-only task).

## Docs to update

- `docs/ui_ux.md` S-01: note that "I have an account" appears from Phase 2 and describe the first-run rule.
- `docs/architecture.md` §4.2: add `onboarding_done` to device-local `meta` keys; §4.7: list precached asset
  types if the config changed.
- `docs/plan.md`: tick both §1.7 checkboxes above.

## Definition of done

- [ ] All scope items implemented
- [ ] Tests written and passing: `just test`, `just e2e` (WebKit)
- [ ] `just lint` clean
- [ ] Works offline in WebKit (verified by the offline spec)
- [ ] Docs updated as listed above; plan.md checkboxes ticked
- [ ] Committed: `feat(web): onboarding flow and offline E2E verification`

## If unclear

If anything in this task is ambiguous or conflicts with the docs, stop and ask before implementing.
