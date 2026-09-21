# P2-T06 — Sync engine

## Context

The server exposes push/pull (P2-T03/T04) and the client can sign in (P2-T05). Every local mutation since Phase 1
already writes an outbox entry `{entity, entity_id}` in the same Dexie transaction. This task builds the client
sync engine: triggers, pushing outbox batches, the pull loop with cursor, LWW merge into Dexie, sync status and
log, clock-skew warning and the sync indicator.

## Read first

- `CLAUDE.md` (always) — offline-first; `review_log` append-only; soft deletes
- `docs/architecture.md` §4.1 (sync engine layer), §4.2 (`outbox`, `meta` keys `sync_cursor`, `last_sync_at`),
  §4.3 step 5, §6.1–§6.4
- `docs/ui_ux.md` §4 (Sync indicator), S-15 (sync block), §6 (pull down on Today), §7 (sync rows)
- `docs/use_cases.md` UC-18, UC-20
- `server/src/sync/lww.rs` test table (P2-T03) — reuse identical cases

## Scope

From `docs/plan.md` §2.3 Sync (client):

- [ ] Sync engine: triggers (start, visible, online, debounced change, manual), push batches, pull loop, cursor
- [ ] LWW merge into Dexie; outbox clearing; error log; clock skew warning
- [ ] Sync indicator component
- [ ] (added) Pull down on Today triggers "Sync now" (ui_ux §6)

## Out of scope

- First sign-in choice (S-03), sign-out wipe, two-context E2E → P2-T07.
- Audio prefetch after sync → P3-T03.

## Implementation steps

1. **Pure merge logic** (`web/src/domain/sync/lww.ts`): `incomingWins(incoming, existing)` with the exact rule of
   §6.1 (larger `updated_at`; tie → larger `updated_by`; equal → false). Port the server test table.
   → verify: Vitest.
2. **Payload building** (`web/src/features/sync/push.ts`): read outbox entries (`++seq` order), group by entity,
   load current rows (including soft-deleted), build `changes` with at most 500 rows per request in dependency
   order (decks → cards → card_states → review_log → settings). Card state entity id = `"{card_id}:{direction}"`.
   Include `review_log.practice`. Remember the outbox `seq` values sent.
3. **Outbox clearing.** After a response: delete outbox entries whose ids are in `applied` or `skipped` **and**
   whose `seq` ≤ the max sent seq (so an edit made during the request is not lost). `rejected` rows stay out of the
   outbox but are written to the sync log with their codes (to avoid infinite retry), and counted in the UI.
4. **Pull loop** (`web/src/features/sync/pull.ts`): `GET /api/sync/pull?cursor=N&limit=500` until
   `has_more = false`. For each row, in one Dexie `rw` transaction per page: if no local row → put; else if
   `incomingWins` → put; else keep local. Skip rows that currently have a pending outbox entry only if the local row
   wins (LWW handles it — no special case beyond the rule). `review_log`: insert if new; else only apply
   `deleted_at`. Deck received with `deleted_at` → also mark its local cards deleted (§6.1). Save `sync_cursor` in
   `meta` in the same transaction as the page. **Pulled rows must not create outbox entries** — add a repository
   write path `applyRemote*` that bypasses the outbox.
   → verify: Vitest with `fake-indexeddb` + mocked API.
5. **Engine** (`web/src/features/sync/engine.ts`): a single-flight `syncNow(reason)` (if running, schedule one more
   run after it finishes). Steps: skip if not signed in or offline → push until outbox empty (max N rounds) → pull
   loop → set `last_sync_at` → append a log entry `{started_at, finished_at, status: 'ok'|'error', pushed, pulled,
   rejected, error_code?}` (keep last 10 in `meta`, key `sync_log`). HTTP 401 → mark session expired, stop.
   Network error → status error, retry with backoff on next trigger.
6. **Triggers** (`web/src/features/sync/triggers.ts`): app start, `visibilitychange` → visible, `online`, manual,
   and 2 s debounced after local changes. For local changes add a lightweight notifier called by the repository
   write helper after commit (e.g. `onLocalChange()` from `web/src/db/`), not a Dexie hook on every table.
7. **Clock skew.** Compare `server_time` from push with `Date.now()`; if `|diff| > 5 min` store `clock_skew_ms` in
   `meta` and show a warning in S-15.
8. **Sync status hook** `useSyncStatus()` → `{state: 'synced'|'syncing'|'pending'|'offline'|'error'|'signed_out',
   pendingCount, lastSyncAt, lastError}` from outbox count (`useLiveQuery`) + engine state.
9. **Sync indicator** (`web/src/features/sync/sync-indicator.tsx`) in the top bar of Today and Settings: ✓ synced,
   spinner syncing, dot with count pending, cloud-off offline, red dot error → tap opens S-15. Hidden when signed
   out. lucide icons, VoiceOver labels.
10. **S-15 sync block:** last sync time (relative via `Intl.RelativeTimeFormat`), pending changes count,
    **Sync now** button, clock-skew warning, sync log (last 10 runs with status, rejected count and "Details" listing
    entity/id/code).
11. **Pull-down on Today (added):** pull-to-refresh gesture on the Today list calls `syncNow('manual')` when signed
    in; no-op otherwise.

## Tests

- Vitest (pure): `incomingWins` table identical to the server's.
- Vitest + `fake-indexeddb`:
  - push builds batches ≤ 500 in dependency order; applied+skipped cleared; entry edited during the request is kept;
    rejected logged and removed from outbox.
  - pull: newer remote overwrites, older remote ignored, remote soft-deleted deck marks local cards deleted,
    review_log undo (`deleted_at`) applied, cursor saved per page, pulled rows create no outbox entries.
  - engine: single-flight; 401 marks session expired; offline skips.
  - skew > 5 min stored.
- Component test: sync indicator renders each state with the right label.
- Playwright (WebKit): signed-in user adds a card → within ~3 s outbox empty and indicator shows synced;
  offline context → indicator shows offline and pending count; back online → synced.

## Invariants to respect

- UI components never call the API directly; only the sync engine does.
- Local mutations keep writing `updated_at`, `updated_by`, outbox in one transaction; remote applies do not.
- `review_log` append-only; only `deleted_at` changes.
- No hardcoded strings (sync states, log statuses, errors in `en.json`/`ru.json`).

## Docs to update

- `docs/architecture.md` §4.2 (`meta` keys: `sync_cursor`, `last_sync_at`, `sync_log`, `clock_skew_ms`), §4.3
  (remote-apply path without outbox), §6.2–§6.4 (outbox clearing rule for rows edited during a request, rejected
  handling).
- `docs/ui_ux.md` §4 / S-15 if the sync block or indicator differ.
- `docs/plan.md`: tick the three checkboxes; add and tick the `(added)` checkbox.

## Definition of done

- [ ] All scope items implemented
- [ ] Tests written and passing: `just test` and `just e2e` (WebKit mandatory)
- [ ] `just lint` clean
- [ ] Works offline in WebKit (changes accumulate, sync resumes online)
- [ ] Docs updated as listed above; plan.md checkboxes ticked
- [ ] Committed: `feat(web): add sync engine with LWW merge and sync indicator`

## If unclear

If anything in this task is ambiguous or conflicts with the docs, stop and ask before implementing.
