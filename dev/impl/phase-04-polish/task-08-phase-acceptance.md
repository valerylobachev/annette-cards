# P4-T08 — Phase 4 acceptance

## Context
Tasks P4-T01 … P4-T07 implemented all study modes, statistics, reminders, FSRS optimization, the quality passes,
the purge job and the documentation refresh. This task verifies the Phase 4 acceptance criteria and fixes gaps.
It adds **no features**. The main criterion is 30 consecutive days of real use, so the task has two parts:
**Part A** (start: automated and manual verification, begin the usage log) and **Part B** (after 30 days:
review the log, fix gaps, close the phase).

## Read first
- `CLAUDE.md` (always; Definition of done; iOS / Safari gotchas)
- `docs/plan.md` Phase 4 (all checkboxes and **Acceptance**)
- `dev/impl/phase-04-polish/00-phase-overview.md` (added criteria)
- `docs/use_cases.md` UC-14, UC-15, UC-19, UC-23, UC-30
- `docs/user-guide/en.md` (for the manual walkthrough)

## Scope
From `docs/plan.md` Phase 4 **Acceptance**:
- 30 consecutive days of daily use by the owner with EN and PL decks without needing any other app.

Added criteria from the phase overview:
- `just lint`, `just test`, `just e2e` (WebKit) pass.
- All four study modes, statistics, reminders and FSRS optimization work on the owner's installed iPhone PWA.
- Performance targets from 4.5 are met and recorded; the purge job has run on the VPS without errors.

## Out of scope
- New features, including Backlog items (shared decks, speech recognition, images, share-sheet capture, native
  wrapper). Record ideas from the 30 days in the Backlog section of `docs/plan.md` instead.

## Implementation steps
**Part A — verification (day 0)**
1. Confirm every Phase 4 checkbox in `docs/plan.md` is ticked; list any that are not and stop. → verify: grep for
   unchecked boxes in the Phase 4 section returns nothing.
2. Run `just lint`, `just test`, `just e2e` (WebKit mandatory). Fix failures in the owning code with minimal
   changes. → verify: all three green.
3. `just build`, `just release`, `just deploy`; check `/api/health` and `/api/meta` (features `tts`, `commons`,
   `enrich`, `push` true on the VPS). → verify: `curl` outputs.
4. Manual checks on the owner's iPhone (installed PWA, iOS 16.4+), recorded as a checklist in
   `dev/impl/phase-04-polish/acceptance-log.md`:
   - Swipe, Choice, Listening (choose and type) and Typing sessions on an EN deck and a PL deck; `żółw` typed as
     `zolw` → amber near miss; undo in every mode.
   - Airplane mode: all four modes work; Statistics renders.
   - Statistics numbers match a hand count for one day; streak equals Today's streak.
   - Reminder at a time two minutes ahead arrives only when due cards exist and nothing studied today; tapping
     opens Today; no reminder after studying.
   - FSRS Optimize on the owner's account (≥ 1 000 reviews) shows the comparison; Apply syncs to the laptop.
   - `annette-cards purge --dry-run` on the VPS prints counts; the daily purge log line exists in `journalctl`.
   → verify: every checklist item marked pass/fail with a note.
5. Start the usage log in the same file: a table `Date | EN reviews | PL reviews | Modes used | Issues | Needed
   another app? (y/n)`. The owner fills it daily (a one-line entry is enough).

**Part B — closing (day 30+)**
6. Review the log: 30 consecutive days with entries, both EN and PL used, "Needed another app?" = n on every day.
   For each issue: fix it (bug) or move it to the Backlog in `plan.md` (feature). → verify: all bugs fixed with
   tests; `just lint`, `just test`, `just e2e` green again.
7. Update README status ("Phase 4 complete — replaces Duocards for daily use") and tick the acceptance in
   `docs/plan.md` (add `- [x] Acceptance verified on <date>` under the Phase 4 Acceptance paragraph).
   → verify: diff shows only status/docs changes plus fixes.

## Tests
- Every bug found in Part A or B gets a regression test at the right level (domain unit, repository with
  fake-indexeddb, router `oneshot`/`#[sqlx::test]`, or Playwright WebKit) before the fix.

## Invariants to respect
- No feature work; fixes must respect all CLAUDE.md invariants (offline-first, outbox, soft deletes, `user_id`
  filtering, no server strings, client-side FSRS).

## Docs to update
- `dev/impl/phase-04-polish/acceptance-log.md` (new): checklist and 30-day usage log.
- `README.md`: status.
- `docs/plan.md`: acceptance line; new Backlog items discovered during use.
- Any doc affected by a fix (as the fix requires).

## Definition of done
- [ ] Part A checklist all pass (or fixed); usage log started — commit
      `chore: start phase 4 acceptance log`
- [ ] Part B: 30 consecutive days logged without needing another app; all found bugs fixed with tests
- [ ] `just lint`, `just test`, `just e2e` (WebKit) green; works offline in WebKit
- [ ] Docs updated as listed above
- [ ] Committed: `chore: verify phase 4 acceptance`

## If unclear
If an acceptance criterion cannot be met without a new feature, stop and ask before implementing.
