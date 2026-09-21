# P1-T01 — Data layer

## Context

Phase 0 produced the web skeleton (Vite, React 19, TanStack Router with placeholder screens, i18n, PWA, Vitest,
Playwright) and the server skeleton. Nothing stores user data yet. This task builds the local data layer that
every Phase 1 feature uses: domain types, the Dexie schema, device identity, UUIDv7 ids and transactional
repositories with the outbox. Getting the write path right now is what makes sync (Phase 2) possible without
rewrites.

## Read first

- `CLAUDE.md` (always) — especially "Architectural invariants"
- `docs/architecture.md` §4.1 (layers), §4.2 (Dexie schema), §4.3 (write path), §5.4 (server data model —
  field names and types to mirror), §5.5 (settings document), §6.1 (LWW fields)
- `docs/tech_stack.md` → Dexie, `uuid` (v7), Vitest, `fake-indexeddb`

## Scope

From `docs/plan.md` §1.1:

- [ ] Domain types (`Deck`, `Card`, `CardState`, `ReviewLog`, `Settings`) matching `architecture.md` §5.4
- [ ] Dexie schema v1 (§4.2), device id generation, UUIDv7 helper
- [ ] Repositories with transactional writes (`updated_at`, `updated_by`, outbox entry) — tests with
      `fake-indexeddb`
- [ ] Settings repository with defaults (§5.5) and device-local preferences in `meta`
- [ ] (added) Settings fields `default_directions` (`'forward' | 'reverse' | 'both'`, default `'both'`) and
      `show_ipa_on_front` (boolean, default `true`) — decision D3

## Out of scope

- Any UI (decks list is P1-T02).
- FSRS logic and session building (P1-T07), answer transaction (P1-T08).
- Sync engine and outbox consumption (P2-T06). The outbox is only written here.
- `practice` flag on `review_log` (added in P1-T08, D2).

## Implementation steps

1. Domain types in `web/src/domain/types.ts`. Mirror §5.4 without `user_id` and `server_seq` (server-only):
   - `Deck { id, name, target_lang, native_lang, directions: Directions, new_per_day: number | null,
     archived_at: number | null, created_at, updated_at, updated_by, deleted_at: number | null }`
   - `Card { id, deck_id, front, back, example, example_translation, ipa, tags: string[], notes, audio_id,
     created_at, updated_at, updated_by, deleted_at }` (optional text fields are `string | null`)
   - `CardState { card_id, direction: 'forward' | 'reverse', state: 0|1|2|3, due, stability, difficulty,
     elapsed_days, scheduled_days, learning_steps, reps, lapses, last_review: number | null, updated_at,
     updated_by, deleted_at }`
   - `ReviewLog { id, card_id, direction, rating: 1|2|3|4, mode: 'swipe'|'choice'|'listen'|'typing',
     state_before: CardStateSnapshot, reviewed_at, duration_ms, updated_at, updated_by, deleted_at }`
   - `Settings` = §5.5 document + D3 fields. All timestamps are `number` ms since epoch.
   → verify: `pnpm tsc --noEmit` passes.
2. `web/src/lib/ids.ts`: `newId()` using `uuid` v7. `web/src/lib/clock.ts`: `now()` (injectable for tests).
   → verify: unit test that two ids are sortable by creation time.
3. `web/src/db/schema.ts`: `AnnetteDb extends Dexie` with `version(1).stores({...})` exactly as §4.2 (tables
   `decks`, `cards`, `card_states`, `review_log`, `settings`, `outbox`, `meta`). Export a singleton `db` and a
   factory for tests. → verify: test opens the DB under `fake-indexeddb` and lists all 7 tables.
4. `web/src/db/device.ts`: `getDeviceId()` — reads `meta` key `device_id`, creates a UUIDv7 on first call.
   → verify: two calls return the same id; a fresh DB returns a new id.
5. `web/src/db/outbox.ts`: `OutboxEntry { seq, entity: 'decks'|'cards'|'card_states'|'review_log'|'settings',
   entity_id: string }`; `addToOutbox(entity, entity_id)` deduplicated by the `[entity+entity_id]` index
   (compound id for `card_states` = `${card_id}:${direction}`). Must be called inside the caller's
   transaction. → verify: writing the same entity twice leaves one outbox row.
6. `web/src/db/write.ts`: helper `stamp(entity)` setting `updated_at = now()`, `updated_by = deviceId`, and a
   `mutate(tables, fn)` wrapper around `db.transaction('rw', [...tables, 'outbox'], fn)`.
7. Repositories (`web/src/db/decks.ts`, `cards.ts`, `cardStates.ts`, `reviewLog.ts`): create, update, soft
   delete (`deleted_at = now()`), get, list (excluding soft-deleted by default). Each write = one transaction:
   validate (domain) → stamp → put → outbox. No physical deletes. `review_log` repository exposes append and
   `softDelete` only (append-only invariant). → verify: repository tests (below).
8. `web/src/db/settings.ts`: `getSettings()` returns the row `id = 'user'` merged over `DEFAULT_SETTINGS`
   (from `web/src/domain/settings.ts`, values exactly as §5.5 + D3); `updateSettings(patch)` stamps and adds
   an outbox entry (`entity: 'settings'`, `entity_id: 'user'`).
9. `web/src/db/meta.ts`: typed get/set for device-local keys: `device_id`, `sync_cursor`, `last_sync_at`,
   `account`, `voice_pref` (per language), `speech_rate`, `theme`, `audio_prefetch`. Meta writes never create
   outbox entries.
10. Hooks `web/src/db/hooks.ts`: `useDecks()`, `useSettings()` etc. via `useLiveQuery`.

## Tests

Vitest + `fake-indexeddb` (`web/src/db/*.test.ts`):
- Creating a deck writes `updated_at`, `updated_by = deviceId` and exactly one outbox entry.
- Updating the same card 3 times → one outbox entry, latest `updated_at`.
- Soft delete sets `deleted_at`; `list()` excludes it; row still exists.
- A failing write (validation throws) rolls back both entity and outbox.
- `review_log` has no update API except `softDelete`.
- `getSettings()` on empty DB returns §5.5 defaults incl. `default_directions: 'both'`,
  `show_ipa_on_front: true`; partial stored row is merged with defaults.
- Meta writes do not touch the outbox.

## Invariants to respect

- Every local mutation sets `updated_at`, `updated_by` and adds an outbox entry inside one Dexie transaction.
- IDs are UUIDv7 generated on the client.
- Deletes are soft. `review_log` is append-only (only `deleted_at` may change).
- UI never calls the HTTP API for user data; repositories are the only data access path.

## Rust learning notes

n/a (web-only task).

## Docs to update

- `docs/architecture.md` §5.5: add `default_directions` and `show_ipa_on_front` with defaults (D3).
- `docs/architecture.md` §4.2: list the concrete `meta` keys if they differ from the text.
- `docs/tech_stack.md`: confirm `fake-indexeddb` is listed (it is under Unit tests); add nothing else.
- `docs/plan.md`: tick the four §1.1 checkboxes and the (added) settings item.

## Definition of done

- [ ] All scope items implemented
- [ ] Tests written and passing: `just test`
- [ ] `just lint` clean
- [ ] Works offline in WebKit (no network calls introduced)
- [ ] Docs updated as listed above; plan.md checkboxes ticked
- [ ] Committed: `feat(web): add Dexie schema, domain types and transactional repositories`

## If unclear

If anything in this task is ambiguous or conflicts with the docs, stop and ask before implementing.
