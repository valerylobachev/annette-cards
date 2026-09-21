# P4-T05 — FSRS optimization

## Context
Scheduling runs on the client with `ts-fsrs` default weights; the settings document already has
`fsrs_weights: null`. After months of use the server holds every user's `review_log`, so it can fit personal FSRS
parameters with the official `fsrs` crate (fsrs-rs). The server only **computes** weights; the client applies them
to its settings and keeps scheduling locally (CLAUDE.md invariant).

## Read first
- `CLAUDE.md` (always; invariant "FSRS scheduling runs on the client")
- `docs/architecture.md` §4.4 (FSRS config, weights "replaced by optimized weights"), §5.1 `fsrs/`, §5.3
  `POST /api/fsrs/optimize`, §5.4 `review_log` (incl. `practice`, `state_before`, `deleted_at`), §5.5
  `fsrs_weights`
- `docs/ui_ux.md` S-14 Study section ("FSRS weights: Optimize button, last optimized date")
- `docs/use_cases.md` UC-30
- `docs/tech_stack.md` → `fsrs` (fsrs-rs), `ts-fsrs`

## Scope
From `docs/plan.md` 4.4:
- [ ] Server endpoint using `fsrs` crate on the user's review log; minimum review count check
- [ ] Client: Optimize button, comparison display, apply weights to settings
- [ ] `fsrs_optimized_at` field in the settings document (added)

## Out of scope
- Automatic periodic optimization; the user triggers it.
- Server-side rescheduling of existing cards (never). Applying weights affects future answers only.

## Implementation steps
1. Version check first: confirm which FSRS version and parameter count the pinned `fsrs` crate produces and which
   `ts-fsrs` accepts (`generatorParameters({ w })`). If they differ, stop and pin compatible versions; record the
   pair in `tech_stack.md`. → verify: a test asserts `weights.len()` equals the expected count.
2. Add the `fsrs` crate. In `server/src/fsrs/`, build training items: load the user's non-deleted, **non-practice**
   `review_log` rows (`WHERE user_id = ? AND deleted_at IS NULL AND practice = 0 ORDER BY card_id, direction,
   reviewed_at`), group by `(card_id, direction)`, convert each history into the crate's item type (rating +
   `delta_t` in days between reviews using the user's `day_start_hour` study days). → verify: unit test for the
   conversion on a hand-written history.
3. Minimum count: `const MIN_REVIEWS: usize = 1000;` (UC-30 "~1 000"). Fewer → `AppError` code
   `not_enough_reviews` (HTTP 422) with `details: { "count": n, "required": 1000 }`. → verify: router test.
4. Optimize in `tokio::task::spawn_blocking` (CPU-heavy, would block the async runtime): compute parameters, then
   evaluate log loss for default and optimized parameters on the same items. Response DTO
   `OptimizeResponse { weights: Vec<f32>, log_loss_default: f64, log_loss_optimized: f64, review_count: i64 }`.
   Rate limit: at most 3 requests per hour per user (`tower_governor`, route-specific), code `rate_limited`.
   The endpoint does **not** write settings. utoipa annotations, then `just gen-api`. → verify: `#[sqlx::test]`
   with a generated log of ~1 200 reviews returns weights of the expected length and finite losses.
5. Client (S-14 Study, "FSRS weights" row): shows "Default" or "Optimized on <date>" from
   `settings.fsrs_optimized_at`. **Optimize** (online only; offline → "Available online") calls the endpoint via
   TanStack Query and first triggers a sync so the server has the latest logs. Result sheet: review count, log
   loss default vs optimized and relative improvement; buttons **Apply** / **Cancel**. `not_enough_reviews` →
   "You have N reviews, at least 1000 are needed" (from `details`). → verify: component tests for success, error,
   offline.
6. Apply: settings repository writes `fsrs_weights` and `fsrs_optimized_at = now` (outbox → syncs to other
   devices). The `ts-fsrs` wrapper from P1-T07 reads `settings.fsrs_weights` (null → defaults). Add **Reset to
   default** that sets `fsrs_weights = null`. → verify: unit test that the scheduler uses custom weights (a
   different next interval for the same input).
7. i18n keys `settings.fsrs.*` and `errors.not_enough_reviews` in `en.json` and `ru.json`. → verify: `just lint`.

## Tests
- Server: 999 non-practice reviews + 50 practice reviews → `not_enough_reviews` with `count = 999` (practice and
  soft-deleted logs excluded).
- Server: another user's logs are never included (two users in the test DB).
- Server: conversion groups forward and reverse of the same card separately; first review has `delta_t = 0`.
- Server: result has finite `log_loss_*` and the expected parameter count.
- Client: Apply writes both fields in one transaction with an outbox entry; Reset sets `fsrs_weights = null`.
- Client: the scheduler with invalid weights (wrong length) falls back to defaults and logs a warning.

## Invariants to respect
- FSRS scheduling stays on the client; the server only returns weights.
- Every server query filters by `user_id`; stable error codes only (`not_enough_reviews`, `rate_limited`).
- UI reads/writes settings only through repositories; the API call is the explicit "server feature" exception.

## Rust learning notes (server tasks only)
Explain briefly in the task summary: why CPU-bound work goes into `tokio::task::spawn_blocking` (and how its
`JoinHandle` result is awaited and mapped into `AppError`), grouping rows with `BTreeMap`/iterators, and how a
typed `details` payload is attached to an error code.

## Docs to update
- `docs/architecture.md` §5.3 (request/response of `/api/fsrs/optimize`, error codes), §5.5
  (`"fsrs_optimized_at": null`), §4.4 (weights source, reset).
- `docs/tech_stack.md`: pinned `fsrs` / `ts-fsrs` compatible versions.
- `docs/use_cases.md` UC-30: exact minimum and exclusion of practice reviews.
- `docs/plan.md`: tick both 4.4 checkboxes and the added settings item.

## Definition of done
- [ ] All scope items implemented
- [ ] Tests written and passing: `just test` (and `just e2e` for the settings flow, WebKit)
- [ ] `just lint` clean
- [ ] Works offline in WebKit (Optimize shows "Available online"; applied weights work offline)
- [ ] Docs updated as listed above; plan.md checkboxes ticked
- [ ] Committed: `feat: add FSRS parameter optimization`

## If unclear
If anything in this task is ambiguous or conflicts with the docs (for example incompatible FSRS versions), stop
and ask before implementing.
