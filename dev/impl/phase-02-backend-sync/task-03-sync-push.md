# P2-T03 — Sync schema and push

## Context

The server has users and sessions (P2-T01/T02). The client (Phase 1) records every local mutation with
`updated_at`, `updated_by` and an outbox entry. This task creates the server-side copies of the synced entities
and implements `POST /api/sync/push`: validation, ownership checks, last-write-wins merge and `server_seq`
allocation. It is the most correctness-critical server code in the project.

## Read first

- `CLAUDE.md` (always) — architectural invariants (soft deletes, append-only `review_log`, `user_id` filter)
- `docs/architecture.md` §5.4 (`sync_seq`, `decks`, `cards`, `card_states`, `review_log`, `user_settings`, indexes),
  §5.5 (settings document incl. fields added by decision D3), §6.1–§6.3, §9 (input limits)
- `dev/impl/00-overview.md` decisions D2 (`review_log.practice`) and D3
- `web/src/domain/` types from P1-T01/T08 (field names must match the client exactly)
- `docs/use_cases.md` UC-20

## Scope

From `docs/plan.md` §2.2 Sync (server):

- [ ] Migrations: `sync_seq`, `decks`, `cards`, `card_states`, `review_log`, `user_settings` with indexes
- [ ] `server_seq` allocation inside transactions
- [ ] Push: validation, ownership checks, LWW merge per entity, dependency order, applied/skipped/rejected
- [ ] (added) Request body limit 2 MB and field length limits (front/back ≤ 500 chars, notes ≤ 2000) (architecture §9)
- [ ] (added) `review_log.practice` column carried through push (decision D2)

## Out of scope

- Pull, summary, export/restore, convergence tests → P2-T04.
- Client sync engine → P2-T06.
- `audio_assets` and `cards.audio_id` handling beyond storing the value the client sends → P3-T01.

## Implementation steps

1. **Migration.** `just db-new sync` → tables and indexes exactly as §5.4, plus `review_log.practice INTEGER NOT NULL
   DEFAULT 0`. Seed `INSERT INTO sync_seq (id, value) VALUES (1, 0)`.
   → verify: `just db-migrate`; schema matches §5.4.
2. **DTOs** (`server/src/sync/dto.rs`, `Serialize + Deserialize + ToSchema`): `DeckDto`, `CardDto`, `CardStateDto`,
   `ReviewLogDto`, `SettingsDto { data: serde_json::Value, updated_at, updated_by }`, `PushRequest { device_id,
   changes: Changes }`, `Changes { decks, cards, card_states, review_log, settings: Option<SettingsDto> }`,
   `PushResponse { applied: AppliedIds, skipped: SkippedIds, rejected: Vec<Rejected>, server_time }`,
   `Rejected { entity, id, code }`. Field names identical to §6.3 and the Dexie rows (snake_case). `tags` is a JSON
   array in the DTO and stored as TEXT. `state_before` is JSON. Card state id in responses = `"{card_id}:{direction}"`.
   → verify: serde roundtrip test with the §6.3 example JSON.
3. **Sequence allocation** (`sync/seq.rs`): `next_seq(tx) -> i64` runs
   `UPDATE sync_seq SET value = value + 1 WHERE id = 1 RETURNING value` on the open transaction.
   → verify: `#[sqlx::test]` two allocations in one tx return consecutive values.
4. **LWW helper** (`sync/lww.rs`): `fn incoming_wins(incoming: (i64, &str), existing: (i64, &str)) -> bool` —
   larger `updated_at` wins; tie → lexicographically larger `updated_by`; equal → false (idempotent, counts as
   skipped). Unit-test with the same table of cases that P2-T06 will use on the client (write them down in the test
   as a table).
5. **Validation** (`sync/validate.rs`): enums (`directions`, `direction`, `mode`, `state` 0..=3, `rating` 1..=4),
   lengths (front/back ≤ 500, example/example_translation ≤ 500, notes ≤ 2000, name ≤ 100, tags ≤ 20 × 50 chars),
   non-empty front/back/name, batch ≤ 500 rows total. Invalid row → `rejected` with `validation_failed` (not a
   whole-request error). Whole body > 2 MB → 413 via `DefaultBodyLimit::max(2 * 1024 * 1024)` on the route.
6. **Push service** (`sync/push.rs`), one sqlx transaction per request, entities in dependency order
   decks → cards → card_states → review_log → settings. For each row:
   - ownership: existing row with same id but different `user_id` → rejected `not_owned`; card's `deck_id` must be a
     deck of the user (existing in DB or earlier in this batch) → else `deck_not_owned`; state/log `card_id` must be a
     user's card → else `card_not_owned`;
   - mutable entities (`decks`, `cards`, `card_states`, `user_settings`): if no existing row → insert; else if
     `incoming_wins` → update all fields; else → skipped;
   - `review_log`: insert if the id is new; if it exists only `deleted_at` may change (set if incoming has it and
     existing does not) → applied; otherwise skipped (never modify other fields);
   - every insert/update sets `server_seq = next_seq(tx)` and `user_id` from `CurrentUser` (ignore any client value).
   Commit; return ids per bucket and `server_time = now_ms()`.
   → verify: tests below.
7. **Handler** `POST /api/sync/push` in `sync/handlers.rs` taking `CurrentUser` + `Json<PushRequest>`; register in
   `app.rs`; utoipa annotations. `device_id` is logged at debug level only.
8. `just sqlx-prepare`, `just gen-api`. → verify: `web/src/api/` exposes the push function and DTO types.

## Tests

`#[sqlx::test]` service tests and one `oneshot` router test:

- new deck + card + two states + one log in one request → all applied; `server_seq` strictly increasing in
  dependency order.
- card referencing another user's deck → rejected `deck_not_owned`; same id owned by another user → `not_owned`.
- card referencing a deck created earlier in the same batch → applied.
- LWW: older incoming → skipped, row unchanged; newer → applied, new `server_seq`; equal `updated_at` → tie broken by
  `updated_by`.
- review_log: re-push same log → skipped (idempotent); push with `deleted_at` set → applied, other fields
  unchanged; attempt to change `rating` → ignored/skipped.
- soft delete of a deck (`deleted_at`) → applied like an update.
- settings: newer applied, older skipped; `applied.settings` boolean correct.
- validation: 501-char front → rejected `validation_failed`; body > 2 MB → 413; unauthenticated → 401.
- `practice` flag stored and preserved.

## Invariants to respect

- Every query filters by `user_id` from the session; parent ownership validated on push.
- Server never recalculates FSRS intervals — it stores `card_states` as sent.
- `review_log` append-only; only `deleted_at` may change.
- Soft deletes only; no physical deletes here.
- `server_seq` only from `sync_seq`, inside the push transaction.

## Rust learning notes (server tasks only)

- **Passing a transaction to helper functions** — `&mut sqlx::Transaction<'_, Sqlite>` / `&mut *tx` and why the
  lifetime appears here.
- **`serde_json::Value`** for semi-structured data (settings, `state_before`) vs typed structs.
- **Enums with `#[serde(rename_all = "snake_case")]`** for `directions`/`mode` validation.
- **Collecting results into buckets** — building `PushResponse` with `Vec` pushes instead of early `?` returns.

## Docs to update

- `docs/architecture.md` §5.4 (`review_log.practice`), §6.3 (`practice` in payload, `rejected` codes list:
  `validation_failed`, `not_owned`, `deck_not_owned`, `card_not_owned`; card state id format), §9 if limits differ.
- `docs/plan.md`: tick the three checkboxes; add and tick the two `(added)` checkboxes.

## Definition of done

- [ ] All scope items implemented
- [ ] Tests written and passing: `just test`
- [ ] `just lint` clean
- [ ] `.sqlx/` refreshed, `just gen-api` run
- [ ] Docs updated as listed above; plan.md checkboxes ticked
- [ ] Committed: `feat(server): add sync tables and push with LWW merge`

## If unclear

If anything in this task is ambiguous or conflicts with the docs, stop and ask before implementing.
