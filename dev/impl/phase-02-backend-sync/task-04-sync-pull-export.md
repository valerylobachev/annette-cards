# P2-T04 — Sync pull and export

## Context

P2-T03 created the synced tables and `POST /api/sync/push` with LWW merge and `server_seq`. This task completes
the server side of sync: cursor-based pull, a summary endpoint for the first-sign-in screen, JSON export and
restore into an empty account, and property-style tests proving that two devices converge.

## Read first

- `CLAUDE.md` (always)
- `docs/architecture.md` §5.3 (`/api/sync/pull`, `/api/export`, `/api/import/json`), §6.1–§6.4
- `dev/impl/00-overview.md` decisions D6 (`/api/sync/summary`) and D9 (restore)
- `web/src/features/` export code from P1-T06 — the JSON backup format (reuse its versioned shape for
  `/api/export` so a server export can be imported locally and vice versa)
- `docs/use_cases.md` UC-04, UC-20, UC-25

## Scope

From `docs/plan.md` §2.2 Sync (server):

- [ ] Pull: cursor paging across entities ordered by `server_seq`
- [ ] Export endpoint (JSON) and restore into an empty account
- [ ] Property-style tests: two simulated devices with interleaved edits converge to the same state
- [ ] (added) `GET /api/sync/summary` → counts of non-deleted decks and cards for S-03 (decision D6)

## Out of scope

- Client use of pull/summary → P2-T06, P2-T07.
- Purge of old soft-deleted rows → P4-T07.

## Implementation steps

1. **Pull service** (`sync/pull.rs`): `pull(pool, user_id, cursor, limit) -> PullResponse`. `limit` default 500,
   clamp 1..=1000. Query each table for `user_id = ? AND server_seq > ?` ordered by `server_seq`, `LIMIT limit + 1`;
   merge the five streams by `server_seq`, take the first `limit` rows; `cursor` = max `server_seq` returned (or the
   input cursor if none); `has_more` = more rows exist beyond it. Include soft-deleted rows (they carry
   `deleted_at`). Settings returned as the latest `user_settings` row if its `server_seq` is within the page.
   Response shape exactly §6.3: `{changes: {decks, cards, card_states, review_log, settings}, cursor, has_more}`.
   → verify: tests below.
2. **Handler** `GET /api/sync/pull?cursor=&limit=` with `Query<PullParams>` and `CurrentUser`.
3. **Summary (added).** `GET /api/sync/summary` → `{decks: i64, cards: i64}` counting rows with
   `deleted_at IS NULL` for the user (cards of deleted decks excluded).
   → verify: router test.
4. **Export.** `GET /api/export` → the same versioned JSON backup format as the client export from P1-T06
   (`format`, `version`, `exported_at`, `decks`, `cards`, `card_states`, `review_log`, `settings`), non-deleted rows
   only, `Content-Disposition: attachment; filename="annette-export-YYYY-MM-DD.json"`.
5. **Restore.** `POST /api/import/json` with the backup body: if the user already has any non-deleted deck → 409
   `account_not_empty`; unsupported `version` → 400 `unsupported_version`. Otherwise insert everything in one
   transaction through the same validation and insert paths as push (reuse `sync/push.rs` functions, `updated_by` =
   `"server-import"`), allocating `server_seq`. Body limit for this route: 20 MB (document it).
   → verify: export from user A, restore into empty user B, pull as B returns the same data.
6. **Property-style convergence test** (`server/tests/sync_convergence.rs` or `sync/tests.rs`): a small in-test
   simulator with two "devices" (maps of rows + outbox + cursor). Using a seeded RNG (`rand::rngs::StdRng`), run N
   (e.g. 200) random scenarios of interleaved operations: create/update/soft-delete deck and card, answer a card
   (state update + log), undo (log `deleted_at`), with random `updated_at` offsets; each device applies client-side
   LWW when pulling (port of the same `incoming_wins` rule), pushes, pulls. After a final push+pull on both, assert
   both device maps equal the server's rows for the user. Print the seed on failure.
   → verify: `cargo test sync_convergence` passes repeatedly.
7. `just sqlx-prepare`, `just gen-api`.

## Tests

- pull on empty account → empty changes, `cursor` = input, `has_more = false`.
- 1 200 rows across entities, `limit=500` → three pages, strictly increasing `server_seq`, no duplicates or gaps,
  last page `has_more = false`.
- pull after an update returns the row once more with a higher `server_seq`.
- pull never returns another user's rows.
- soft-deleted rows are included.
- summary counts exclude deleted decks/cards.
- export → restore roundtrip equal; restore into non-empty account → 409 `account_not_empty`; bad version → 400.
- convergence property test (above).

## Invariants to respect

- `user_id` filter in every query; cursor is server `server_seq`, never client clocks.
- Restore does not bypass validation or ownership logic.
- No physical deletes.

## Rust learning notes (server tasks only)

- **Query extractor** `Query<PullParams>` with `Option` fields and defaults.
- **Merging sorted streams** — simple approach with `Vec` + `sort_by_key` is fine for 5 × 501 rows.
- **Property-style tests with a seeded RNG** — reproducibility without adding `proptest` (add `proptest` only if it
  clearly removes work; then note it in `tech_stack.md`).
- **Custom response headers** — returning `([(header::CONTENT_DISPOSITION, …)], Json(..))`.

## Docs to update

- `docs/architecture.md` §5.3: add `GET /api/sync/summary`; export/restore body format and limits; error codes
  `account_not_empty`, `unsupported_version`. §6.3: pull paging details if refined. §6.4: S-03 uses the summary.
- `docs/use_cases.md` UC-04 step 1: "asks the server for account data counts (`GET /api/sync/summary`)".
- `docs/plan.md`: tick the three checkboxes; add and tick the `(added)` summary checkbox.

## Definition of done

- [ ] All scope items implemented
- [ ] Tests written and passing: `just test`
- [ ] `just lint` clean
- [ ] `.sqlx/` refreshed, `just gen-api` run
- [ ] Docs updated as listed above; plan.md checkboxes ticked
- [ ] Committed: `feat(server): add sync pull, summary, export and restore`

## If unclear

If anything in this task is ambiguous or conflicts with the docs, stop and ask before implementing.
