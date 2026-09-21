# P2-T07 — First sign-in and sign-out

## Context

Sign-in/registration (P2-T05) and the sync engine (P2-T06) work, but signing in on a device that already has
local-only data would silently merge it, and signing out does not protect unsynced changes or clear local data.
This task implements the first-sign-in choice (S-03), a safe sign-out, and the end-to-end proof that two devices
sync edits and study progress.

## Read first

- `CLAUDE.md` (always)
- `docs/ui_ux.md` S-03, S-15 (Sign out), §4 (Confirm sheet)
- `docs/use_cases.md` UC-03 (sign out), UC-04, UC-20
- `docs/architecture.md` §6.4, §5.3 (`/api/sync/summary`, `/api/auth/logout`)

## Scope

From `docs/plan.md` §2.3 Sync (client):

- [ ] First sign-in flow with local data (S-03): merge / use account / cancel
- [ ] Sign-out with unsynced-changes warning and local wipe
- [ ] E2E: two browser contexts sync edits and study progress

## Out of scope

- Server changes (summary endpoint exists since P2-T04).
- Deleting cached audio beyond clearing Cache Storage (audio cache arrives in P3-T03; clearing all caches now
  covers it).

## Implementation steps

1. **Detect local data.** `hasLocalData()` in `web/src/db/`: any non-deleted deck exists. Track whether the device
   was ever synced: `meta.sync_cursor` present.
2. **Post-auth flow** (`web/src/features/sync/first-sync.ts`), called after successful sign-in/registration:
   - no local data or already synced for this account → start normal sync (P2-T06), go to Today;
   - local data and never synced → `GET /api/sync/summary`:
     - server empty (`decks = 0`) → push everything, then pull; go to Today;
     - both non-empty → route to S-03.
   Pushing "everything" = ensure every local row has an outbox entry (`enqueueAll()` helper in `web/src/db/`, one
   transaction) then run the engine.
3. **S-03 route** `/first-sync`: counts "On this device: N decks, M cards · In your account: X decks, Y cards" with
   Russian plurals; options:
   - **Merge** (recommended) → `enqueueAll()` → push → pull;
   - **Use account data** → confirm sheet ("local data will be removed") → wipe local user data (keep `device_id`
     and device-local preferences) → reset cursor → pull;
   - **Cancel** → `POST /api/auth/logout`, `clearAccount()`, local data untouched, back to previous screen.
   Determinate progress bar during initial sync (pulled rows / expected from summary; push progress by batches).
4. **Sign-out** (S-15 **Sign out** button): if outbox not empty and online → attempt `syncNow`; if still not empty
   (or offline) → confirm sheet "N unsynced changes will be lost" with "Sign out anyway" / "Cancel". Then
   `POST /api/auth/logout` (ignore network failure), delete the Dexie database content (all tables, then recreate
   `device_id` fresh or keep — keep device-local preferences out; document the decision), `caches.keys()` → delete
   all, navigate to onboarding (S-01).
   → verify: after sign-out IndexedDB has no decks and Cache Storage is empty.
5. Session-expired (401) state from P2-T06: "Sign in again" leads through S-02 and then through this flow with the
   same account → treated as already synced (cursor exists), no S-03.
6. i18n keys for S-03 and sign-out in `en.json` and `ru.json`.

## Tests

- Vitest + `fake-indexeddb` with mocked API:
  - no local data → no S-03; local data + empty server → push-all then pull; both non-empty → S-03 route chosen;
  - Merge enqueues every row exactly once; Use account data wipes user tables but keeps device prefs; Cancel logs
    out and leaves data intact;
  - sign-out with pending outbox shows warning; confirm wipes Dexie and caches.
- Playwright (WebKit + Chromium), two browser contexts A and B against `just dev` with a seeded account:
  1. A creates a deck and 3 cards offline-first, sync → B signs in (fresh, no local data) → sees the deck and cards.
  2. B studies one card (answer) → A syncs → the card state and review log appear on A (e.g. due date changed).
  3. Both edit the same card offline (A earlier, B later) → reconnect both → both show B's version (LWW).
  4. Context C with local-only data signs in → S-03 shown → Merge → both datasets present.
  5. Sign-out on A with an unsynced change offline → warning shown.

## Invariants to respect

- Destructive actions (wipe) only after explicit confirmation.
- Soft deletes for synced entities; local wipe on sign-out is the only physical clear and is local-only.
- No hardcoded strings; plurals for counts.

## Docs to update

- `docs/architecture.md` §6.4: exact definition of "local data", what the wipe keeps (`device_id`, device-local
  preferences or not), use of `/api/sync/summary`.
- `docs/use_cases.md` UC-04 / UC-03 if the flow details differ.
- `docs/ui_ux.md` S-03 if the progress indication differs.
- `docs/plan.md`: tick the three checkboxes.

## Definition of done

- [ ] All scope items implemented
- [ ] Tests written and passing: `just test` and `just e2e` (WebKit mandatory)
- [ ] `just lint` clean
- [ ] Works offline in WebKit (sign-out warning offline; local app unaffected by Cancel)
- [ ] Docs updated as listed above; plan.md checkboxes ticked
- [ ] Committed: `feat(web): add first-sync choice, safe sign-out and two-device sync e2e`

## If unclear

If anything in this task is ambiguous or conflicts with the docs, stop and ask before implementing.
