# P1-T08 — Answers, undo, practice

## Context

P1-T07 delivered the FSRS wrapper, study-day counters and the session builder (pure). This task adds the write
side of studying: the atomic answer transaction (next state + review log with `state_before` + outbox), undo of
the last answer, and practice mode for difficult words, which logs answers but does not change FSRS state for
cards that are not due. Per decision D2, `review_log` gets a `practice` flag. It also owns the §1.4 unit-test
checkbox covering the whole study engine.

## Read first

- `CLAUDE.md` (always) — "`review_log` is append-only"
- `docs/architecture.md` §4.4 (Answer transaction, Undo), §5.4 `review_log`, `card_states`, §6.1
- `docs/use_cases.md` UC-11, UC-16, UC-17
- `docs/ui_ux.md` S-12 ("Repeat these now" = practice mode)
- `dev/impl/00-overview.md` → decision D2

## Scope

From `docs/plan.md` §1.4:

- [ ] Answer transaction: next state + review log (with `state_before`) + outbox, atomically
- [ ] Undo last answer
- [ ] Practice mode for difficult words (no FSRS change for non-due cards)
- [ ] Unit tests covering queue order, limits, day boundary, burying, undo
- [ ] (added) `practice` boolean on `ReviewLog` (default `false`) — D2

## Out of scope

- Study UI, undo button, practice entry points (P1-T09, P1-T10).
- Server `practice` column (P2-T03).

## Implementation steps

1. Extend `ReviewLog` in `web/src/domain/types.ts` with `practice: boolean`. No Dexie index change is needed
   (schema v1 stays; field is not indexed). → verify: `tsc` passes.
2. Repository `web/src/db/study.ts`: `answer({ card_id, direction, rating, mode, duration_ms, practice }, now)`:
   - read current `card_states` row;
   - if `practice && state.due > now` → do **not** change the state; else compute `nextState` (P1-T07);
   - in one `rw` transaction on `card_states`, `review_log`, `outbox`: put new state (stamped), append a
     `review_log` row `{ id: newId(), state_before: snapshot of the previous state, reviewed_at: now,
     practice, … }` stamped, outbox entries for both;
   - return `{ log_id, nextState, reinsert: boolean }` (reinsert per `reinsertLearning` rule).
   → verify: tests below.
3. `undoAnswer(log_id)`: in one transaction — load the log, restore `card_states` from `state_before`
   (stamped with a **new** `updated_at` so it wins LWW), set `review_log.deleted_at = now` (stamped), outbox
   entries for both. Refuse (`undo_not_last`) when `log_id` is not the latest non-deleted log of the session;
   the session layer (P1-T09) tracks the id. One level only.
4. `web/src/domain/practice.ts`: `buildPracticeQueue({ cards, states, logs, deckFilter?, failedIds? })` →
   cards with lapses ≥ 3 or stability < 2 days in any active direction, or ids failed (Again) in the last
   session (`failedIds`); ordered by lapses desc; limit 50. Pure.
5. Counters (P1-T07) must exclude `practice === true` logs from `newIntroducedToday` / `reviewsDoneToday`,
   and soft-deleted logs.
6. Consolidate study-engine tests in `web/src/domain/__tests__/` (order, limits, day boundary, burying, undo) so
   the §1.4 test checkbox is visibly covered.

## Tests

Vitest (pure + fake-indexeddb):
- New card rated Good → state changes, one log with `state_before.state === 0`, outbox has
  `card_states` + `review_log` entries; transaction failure leaves both untouched.
- Again on a Review card → Relearning, `lapses + 1`, `reinsert === true` for short next interval.
- Undo → state deep-equals the snapshot (except `updated_at`/`updated_by`), log `deleted_at` set, counters
  drop by one; second undo of an older log → `undo_not_last`.
- Practice on a card due tomorrow → state unchanged, log `practice: true`; practice on an overdue card →
  scheduled normally.
- Practice logs not counted in daily counters.
- Queue order/limits/day boundary/burying (reuse or extend P1-T07 tests; ensure all five topics exist).

## Invariants to respect

- `review_log` append-only; the only change is soft delete for undo.
- Every mutation stamped and outboxed in one transaction.
- FSRS scheduling on the client only.

## Rust learning notes

n/a (web-only task).

## Docs to update

- `docs/architecture.md` §5.4 `review_log`: add `practice INTEGER NOT NULL DEFAULT 0` (D2; the server migration
  is created in P2-T03).
- `docs/architecture.md` §4.4: describe the practice rule and that practice logs are excluded from daily
  counters; §6.3: mention the `practice` field in `review_log` payload rows.
- `docs/use_cases.md` UC-16: reference the `practice` flag by name.
- `docs/plan.md`: tick the four §1.4 checkboxes above and the (added) item.

## Definition of done

- [ ] All scope items implemented
- [ ] Tests written and passing: `just test`
- [ ] `just lint` clean
- [ ] Works offline in WebKit
- [ ] Docs updated as listed above; plan.md checkboxes ticked
- [ ] Committed: `feat(web): atomic answer transaction, undo and practice mode`

## If unclear

If anything in this task is ambiguous or conflicts with the docs, stop and ask before implementing.
