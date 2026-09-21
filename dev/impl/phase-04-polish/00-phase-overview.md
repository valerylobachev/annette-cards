# Phase 4 — Polish

**Goal:** everything needed to fully replace Duocards.
**Use cases:** UC-14, UC-15, UC-19, UC-23, UC-30 (plus quality work across all use cases)
**Screens:** S-04 (mode selector), S-11 (Modes B, C, D), S-13, S-14 (Reminders, FSRS weights, listening answer)
**Prerequisites:**
- Phases 0–3 complete: local study, sync, deployment, server audio and AI enrichment work on the owner's iPhone.
- The server audio playback chain from P3-T03 exists (listening mode reuses it).
- **Reminders (P4-T04):** VAPID key pair generated and stored in `/etc/annette-cards/env` on the VPS
  (`ANNETTE_VAPID_PUBLIC_KEY` / `ANNETTE_VAPID_PRIVATE_KEY`); an iPhone on **iOS 16.4+** with the app
  **installed to the Home Screen** (Web Push does not work in a Safari tab).
- **FSRS optimization (P4-T05):** a real account with **≥ 1 000 review log entries** for the manual check;
  automated tests use generated review logs.
- **Performance pass (P4-T06):** a generated 10 000-card deck (script written in that task).

## Tasks

| # | File | Scope (plan.md section) | Depends on | Est. size |
| --- | --- | --- | --- | --- |
| 01 | [task-01-typing-mode.md](task-01-typing-mode.md) | 4.1a — Typing mode | Phase 1 study engine and session shell | M |
| 02 | [task-02-choice-listening-modes.md](task-02-choice-listening-modes.md) | 4.1b — Multiple choice, Listening, Mode selector | T01, P3-T03 | L |
| 03 | [task-03-statistics.md](task-03-statistics.md) | 4.2 — Statistics screen, streak logic | T02 (all modes write logs) | M |
| 04 | [task-04-reminders.md](task-04-reminders.md) | 4.3 — VAPID, reminder task, client permission flow | Phase 2 auth/sync, T03 (study-day helpers) | L |
| 05 | [task-05-fsrs-optimization.md](task-05-fsrs-optimization.md) | 4.4 — Optimize endpoint and client | Phase 2 sync (server has review logs) | M |
| 06 | [task-06-accessibility-performance.md](task-06-accessibility-performance.md) | 4.5a — Accessibility pass, Performance pass | T01–T05 (all screens exist) | M |
| 07 | [task-07-purge-docs.md](task-07-purge-docs.md) | 4.5b — Purge job, Documentation refresh | T06 | M |
| 08 | [task-08-phase-acceptance.md](task-08-phase-acceptance.md) | Phase 4 acceptance | T01–T07 | S (+30 days of use) |

## Execution notes

- **Split of 4.1 (study modes).** Four checkboxes with three new exercise UIs are more than one focused session.
  Typing goes **first** (T01) because it creates `web/src/domain/answer.ts` (normalization, Damerau–Levenshtein,
  near-miss detection, diff) and the listening mode can be answered **by typing** (`listening_answer: 'type'`),
  so T02 reuses it. T02 adds multiple choice, listening and the Today mode selector (decision D4: Phase 1 Today
  has no mode chips).
- **Split of 4.5 (quality).** T06 is a measure-and-fix pass on the client (accessibility, 10 000-card
  performance) plus the 1 GB SQLite decision from `architecture.md` §15. T07 is server maintenance (purge job and
  the `purge` CLI subcommand, decision D7) and the documentation refresh, which must come last so screenshots and
  the user guide show the final UI.
- **Streak (D5).** Phase 1 (P1-T10) created a minimal `web/src/domain/streak.ts` for Today. T03 owns the
  "Streak logic based on study days" checkbox: it completes the function (longest streak, `day_start_hour`
  boundaries, time-zone changes) and keeps Today using the same function.
- **Settings additions (D3).** `listening_answer: 'choose' | 'type'` (T02) and `fsrs_optimized_at` (T05) are new
  fields of the settings document; each task updates `architecture.md` §5.5 and the settings defaults.
- **Easy to get wrong in this phase:**
  - Server must not send user-visible strings (CLAUDE.md invariant): push payloads carry data only, and the
    service worker localizes the notification text.
  - FSRS parameter count/version of the Rust `fsrs` crate must match what `ts-fsrs` accepts; verify before
    applying weights.
  - Practice answers (`practice = true`, D2) must be excluded from FSRS optimization and from retention
    statistics.
  - Purge must delete children before parents (foreign keys) and must never touch rows that are not soft-deleted.

## Phase acceptance

From `docs/plan.md`:

> 30 consecutive days of daily use by the owner with EN and PL decks without needing any other app.

Added criteria (verified in T08):
- `just lint`, `just test`, `just e2e` (WebKit) pass.
- All four study modes, statistics, reminders and FSRS optimization work on the owner's installed iPhone PWA.
- Performance targets from 4.5 are met and recorded; the purge job has run on the VPS without errors.
