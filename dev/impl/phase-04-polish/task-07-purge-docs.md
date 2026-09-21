# P4-T07 — Purge job and documentation refresh

## Context
Soft deletes (`deleted_at`) have accumulated since Phase 1, and replaced or removed audio leaves orphaned rows in
`audio_assets` (BLOBs). `architecture.md` §11 specifies a daily purge, and §5.1 / `tech_stack.md` list a `purge`
CLI subcommand that `CLAUDE.md` does not yet mention (decision D7). The UI is now final (P4-T06), so this is also
the moment to refresh the README (status, screenshots) and write the user guide in Russian and English.

## Read first
- `CLAUDE.md` (always; invariant "Physical purge only by server maintenance job"; Commands; `main.rs` line)
- `docs/architecture.md` §5.1 (`main.rs` CLI incl. `purge`), §5.4 (all synced tables, `audio_assets`,
  foreign keys), §6.1 (soft deletes propagate), §11 Purge (daily, soft-deleted > 90 days, orphaned audio), §12
- `docs/use_cases.md` UC-29
- `README.md` (whole file), `docs/ui_ux.md` (screen names for the guide)

## Scope
From `docs/plan.md` 4.5:
- [ ] Purge job for old soft-deleted rows and orphaned audio
- [ ] Documentation refresh (README screenshots, user guide in RU/EN)
- [ ] `purge` CLI subcommand (`annette-cards purge [--dry-run] [--older-than-days 90]`) (added)

## Out of scope
- Session cleanup (already hourly since P2-T01).
- `VACUUM` / file shrinking; the freed pages are reused by SQLite. Mention it in `deploy/README.md` only.
- Marketing site or public docs hosting.

## Implementation steps
1. `server/src/purge.rs` (maintenance service, no HTTP): `pub async fn purge(pool, now_ms, older_than_days) ->
   Result<PurgeReport, AppError>` with `PurgeReport { review_log, card_states, cards, decks, audio_assets }`
   counts. In one transaction, with `cutoff = now − older_than_days·86 400 000`, delete in child → parent order:
   - `review_log` rows with `deleted_at < cutoff`, and logs of cards that will be purged;
   - `card_states` with `deleted_at < cutoff`, and states of cards that will be purged;
   - `audio_assets` of cards that will be purged;
   - `cards` with `deleted_at < cutoff` (and cards of decks that will be purged);
   - `decks` with `deleted_at < cutoff`;
   - orphaned audio: `audio_assets` whose card no longer exists or whose `id` differs from `cards.audio_id`
     and is older than 1 day (so a just-generated clip is not raced).
   Rows without `deleted_at` or newer than the cutoff are never touched. Run `just sqlx-prepare`.
   → verify: `#[sqlx::test]` cases below.
2. Background task: in `serve`, a daily `tokio::time::interval` (24 h, first tick ≈ 5 min after start) calling
   `purge(…, 90)`; log the report with `tracing::info!`; errors logged, never fatal. → verify: log line appears
   in a local run with a shortened interval in a test build/feature flag or a unit test of the scheduler helper.
3. CLI: `annette-cards purge [--dry-run] [--older-than-days <N>]` in `main.rs` (`clap`), reusing the same
   service function; `--dry-run` runs the transaction and rolls back, printing the counts. → verify:
   `cargo run -- purge --dry-run` against a dev DB prints counts.
4. Known limitation: a device offline for more than 90 days could push back a row that was purged. Document it in
   `architecture.md` §6.1 (acceptable for a personal app; mitigation = sign out/in on such a device).
5. Screenshots: add a Playwright spec `web/tests/e2e/screenshots.spec.ts` (WebKit, iPhone viewport, seeded demo
   deck, light theme, EN and RU) that writes PNGs to `docs/images/` for Today, Study (swipe), Deck detail,
   Statistics, Settings; it is excluded from the default `just e2e` run (tag `@screenshots`). → verify: the spec
   produces the images.
6. User guide: `docs/user-guide/en.md` and `docs/user-guide/ru.md` (same structure): install on iPhone, first
   run, decks and cards, import format (link to README section), study modes and gestures, pronunciation and
   voices, AI fill, sync and accounts, backups, reminders, FAQ (data safety, offline). Plain language, with
   screenshots from step 5. → verify: all relative links resolve (`grep` + `test -f`).
7. README: update Status (all phases implemented), add a screenshots row, link the user guides in the
   Documentation list, confirm Getting started commands still work (`just db-migrate`, `create-user`,
   `just dev`). → verify: follow Getting started in a clean clone.

## Tests
- Purge deletes a deck soft-deleted 91 days ago together with its cards, states, logs and audio.
- Purge keeps a deck soft-deleted 89 days ago and everything active.
- Purge keeps a live card whose single review log was undone 10 days ago; deletes an undone log from 100 days ago.
- Orphaned audio: replaced clip (card now points to another `audio_id`) older than 1 day is deleted; the current
  clip is kept; a clip created 1 hour ago is kept.
- Multi-user: purge never deletes non-deleted rows of any user (fixtures with two users).
- `--dry-run` leaves row counts unchanged.

## Invariants to respect
- Physical deletes happen **only** here (maintenance job / CLI), never from sync or handlers.
- Children before parents (foreign keys ON); one transaction per run.
- `review_log` rows are removed only when soft-deleted or their card is purged.

## Rust learning notes (server tasks only)
Explain briefly in the task summary: reusing one async service function from both a background `tokio::spawn`
loop and a `clap` subcommand, `sqlx` transactions (`pool.begin()`, `commit`/`rollback` for dry-run), and a report
struct returned from the service instead of printing inside it.

## Docs to update
- `CLAUDE.md`: `main.rs` line → `serve | create-user | invite | openapi | purge`; mention the purge job under
  invariants if wording needs it.
- `docs/architecture.md` §5.1, §11 (exact purge rules, orphan definition), §6.1 (known limitation).
- `deploy/README.md`: running `purge --dry-run` on the VPS; note about SQLite free pages.
- `README.md`: status, screenshots, user guide links. New `docs/user-guide/{en,ru}.md`, `docs/images/`.
- `docs/plan.md`: tick both 4.5 checkboxes covered here and the added CLI item.

## Definition of done
- [ ] All scope items implemented
- [ ] Tests written and passing: `just test` (and `just e2e`)
- [ ] `just lint` clean
- [ ] Docs updated as listed above; plan.md checkboxes ticked
- [ ] Committed: `feat(server): add purge job and CLI; docs: refresh README and add user guide`
      (one commit, type `feat(server)`, message mentions the docs)

## If unclear
If anything in this task is ambiguous or conflicts with the docs, stop and ask before implementing.
