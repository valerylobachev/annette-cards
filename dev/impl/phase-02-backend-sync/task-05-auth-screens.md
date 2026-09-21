# P2-T05 — Auth screens and Account & sync

## Context

The server API for auth, invites, push, pull, summary and export exists (P2-T01…T04) and the orval client in
`web/src/api/` is generated. The PWA is still local-only. This task adds sign-in and registration (S-02), the
account part of Account & sync (S-15) including the admin Invites section, localized error codes and the shared
"Available online" hint. Sync itself is wired in P2-T06.

## Read first

- `CLAUDE.md` (always) — offline-first invariant: only auth/sync/audio/enrich features call the API
- `docs/ui_ux.md` S-02, S-15, §4 (Offline hint), §7, S-14 About
- `docs/use_cases.md` UC-02, UC-03, UC-28
- `docs/architecture.md` §4.2 (`meta` holds account info), §4.6 (error codes → `errors.<code>`), §5.3
- `docs/tech_stack.md` → TanStack Query, orval

## Scope

From `docs/plan.md` §2.3 Sync (client):

- [ ] Auth screens (S-02) and Account & sync (S-15) incl. admin invites section
- [ ] (added) Shared Offline hint component ("Available online") used by server-only actions
- [ ] (added) Server version (from `GET /api/meta`) in Settings → About
- [ ] (added) Show the "I have an account" button on onboarding S-01 step 1 (hidden in Phase 1 by P1-T13); it opens S-02 Sign in (UC-01 alt 2a)

## Out of scope

- Sync engine, sync status/log/"Sync now" in S-15, sync indicator → P2-T06.
- First sign-in choice (S-03) and sign-out wipe → P2-T07 (in this task, sign-in simply stores account info and
  sign-out is not exposed yet, or calls logout without wiping — prefer not exposing it until T07).

## Implementation steps

1. **Query client.** Set up TanStack Query `QueryClientProvider` in `web/src/app/` (if not done in Phase 0);
   configure orval's fetcher to use `credentials: 'same-origin'` and to parse `{code, details}` errors into a typed
   `ApiError { status, code }`. → verify: unit test for the error parser.
2. **Error localization.** `web/src/lib/apiErrors.ts`: `errorMessageKey(code) → 'errors.<code>'` with fallback
   `errors.unknown`. Add keys in both `en.json` and `ru.json` for: `invalid_credentials`, `invite_invalid`,
   `invite_expired`, `email_taken`, `rate_limited`, `password_too_short`, `validation_failed`, `unauthorized`,
   `forbidden`, `invite_used`, `origin_mismatch`, `network`, `unknown`.
   → verify: test that every code listed in `architecture.md` §5.3 has a key in both files.
3. **Online status.** `web/src/lib/useOnline.ts` (`navigator.onLine` + `online`/`offline` events).
   **OfflineHint** component (`web/src/components/offline-hint.tsx`): renders "Available online" caption next to a
   disabled action when offline. → verify: component test.
4. **Account store.** `web/src/features/auth/account.ts`: repository functions over Dexie `meta`:
   `getAccount()`, `setAccount({user_id, email, display_name, is_admin})`, `clearAccount()`; hook
   `useAccount()` via `useLiveQuery`. Account info is device-local (not synced).
5. **S-02 route** `/auth` (and `/register?invite=CODE` → opens Register tab prefilled): segmented control Sign in |
   Register; sign-in: email, password with show/hide; register: invite code, display name, email, password with a
   simple strength hint (length ≥ 10 required). Inputs 16 px font. Offline → form disabled with
   "Connect to the internet to sign in". Errors under the form from `errors.<code>`. On success: `setAccount` from
   the response and navigate to S-15 (P2-T07 will insert S-03 here).
   → verify: component tests with MSW or mocked orval functions.
6. **S-15 route** `/settings/account`: signed out → explanation "Sign in to back up and sync" + Sign in / Register
   buttons. Signed in → display name, email, Change password (sheet: current, new; calls
   `POST /api/auth/password`), "Sign out other devices" (confirm sheet → `POST /api/auth/logout-others`), placeholder
   area for the sync block (T06). On app start, if an account is stored and online, call `GET /api/auth/me`; 401 →
   mark session expired (show "Sign in again" banner, keep local data).
7. **Admin Invites** (only if `is_admin`): list via `GET /api/admin/invites` with status badges (active / used /
   expired), "Create invite" sheet (note, expiry days default 7) → shows link
   `${location.origin}/register?invite=CODE` with Copy (Clipboard API) and Share (`navigator.share` when available),
   Revoke (confirm sheet) for active invites. All actions wrapped in OfflineHint.
8. **About.** In S-14 About show server version from `GET /api/meta` (TanStack Query, only when online; otherwise
   "—").
9. Register new routes in TanStack Router; add a link from Settings → Account & sync.

## Tests

- Vitest + Testing Library: sign-in success stores account; `invalid_credentials` shows translated text in RU and
  EN; offline disables the form; register prefill from `?invite=`; `invite_expired` shown.
- Admin section hidden for non-admin; create invite shows link; revoke calls DELETE.
- `me` → 401 shows the session-expired banner and keeps local data.
- Playwright (WebKit + Chromium) against `just dev`: create admin via CLI in test setup (or a seeded test DB), sign in,
  create invite, open the link in a second context, register, see account screen. Offline context: sign-in form
  disabled.

## Invariants to respect

- UI never reads or writes user data (decks/cards/…) via the API; only auth/admin/meta calls here.
- No hardcoded strings: every label and error in `en.json` and `ru.json`, Russian plurals where counts appear.
- Never edit `web/src/api/` by hand; if the API needs a change, change the server and run `just gen-api`.
- iOS: inputs ≥ 16 px, safe areas respected.

## Docs to update

- `docs/ui_ux.md` S-02 / S-15: session-expired banner and any detail that differs from the doc.
- `docs/architecture.md` §4.2: account info keys stored in `meta`.
- `docs/plan.md`: tick the checkbox; add and tick the two `(added)` checkboxes.

## Definition of done

- [ ] All scope items implemented
- [ ] Tests written and passing: `just test` and `just e2e` (WebKit mandatory)
- [ ] `just lint` clean
- [ ] Works offline in WebKit (form disabled, local app unaffected)
- [ ] Docs updated as listed above; plan.md checkboxes ticked
- [ ] Committed: `feat(web): add sign-in, registration and account screen with invites`

## If unclear

If anything in this task is ambiguous or conflicts with the docs, stop and ask before implementing.
