# Phase 1 — Local MVP (no backend required)

**Goal:** the owner studies English words on the iPhone every day, fully offline.
**Use cases:** UC-01, UC-05, UC-06, UC-07, UC-08, UC-10, UC-11, UC-12, UC-16, UC-17, UC-18, UC-21, UC-22,
UC-24, UC-26, UC-27
**Screens:** S-01, S-04, S-05, S-06, S-07, S-08, S-09, S-10, S-11, S-12, S-14, S-16
**Prerequisites:** Phase 0 complete (`just dev` runs; web skeleton with routes, i18n, PWA, Biome, Vitest,
Playwright WebKit). No server, no external accounts. A real iPhone for the acceptance task.

## Tasks

| # | File | Scope (plan.md section) | Depends on | Est. size |
| --- | --- | --- | --- | --- |
| 01 | [task-01-data-layer.md](task-01-data-layer.md) | 1.1 Data layer | P0 | M |
| 02 | [task-02-decks-list.md](task-02-decks-list.md) | 1.2a Decks list, card states per direction | 01 | M |
| 03 | [task-03-card-editor-quick-add.md](task-03-card-editor-quick-add.md) | 1.2b Card editor, Quick add | 02 | M |
| 04 | [task-04-deck-detail-card-view.md](task-04-deck-detail-card-view.md) | 1.2c Deck detail, Card view | 03 | L |
| 05 | [task-05-csv-import.md](task-05-csv-import.md) | 1.3a CSV parser, Import wizard | 03 | L |
| 06 | [task-06-export-backup.md](task-06-export-backup.md) | 1.3b Export, JSON backup import | 05 | M |
| 07 | [task-07-scheduler-session-builder.md](task-07-scheduler-session-builder.md) | 1.4a FSRS wrapper, study day, session builder | 01 | M |
| 08 | [task-08-answers-undo-practice.md](task-08-answers-undo-practice.md) | 1.4b Answer transaction, undo, practice, tests | 07 | M |
| 09 | [task-09-study-session-swipe.md](task-09-study-session-swipe.md) | 1.5a Session shell, swipe cards | 08 | L |
| 10 | [task-10-today-summary.md](task-10-today-summary.md) | 1.5b Today, summary, reduced motion, VoiceOver | 09 | M |
| 11 | [task-11-speech.md](task-11-speech.md) | 1.6 Speech | 09 | M |
| 12 | [task-12-settings-install.md](task-12-settings-install.md) | 1.7a Settings, install hint, persistence | 11 | M |
| 13 | [task-13-onboarding-offline.md](task-13-onboarding-offline.md) | 1.7b Onboarding, offline verification | 12 | M |
| 14 | [task-14-phase-acceptance.md](task-14-phase-acceptance.md) | Phase 1 acceptance | 01–13 | M |

## Why subsections were split

- **1.2 → T02–T04.** Six checkboxes covering five screens (S-05…S-09) plus shared UI components. One task would
  be several days of UI work. T02 owns decks and the card-state/direction logic that every later card write
  uses. T03 owns card creation (editor + quick add) and the shared `normalizeFront`. T04 owns browsing (deck
  detail, card view), which needs cards to exist.
- **1.3 → T05–T06.** The CSV import wizard (worker, mapping, validation, duplicates) is a large feature on its
  own. Export and JSON restore share a versioned backup format and belong together.
- **1.4 → T07–T08.** T07 is pure scheduling logic (no Dexie writes); T08 is the transactional write side
  (answer, undo, practice). This keeps each task testable in isolation and keeps T07 reviewable.
- **1.5 → T09–T10.** The swipe card with `motion` is the most complex UI in the app; Today and summary are
  simpler screens that depend on the session existing.
- **1.7 → T12–T13.** Settings is a large grouped screen; onboarding reuses its controls and must come after it.
  Offline verification is the final gate of the phase's client work and sits with onboarding (first run).

## Execution notes

- Every write goes through `web/src/db/` repositories in one Dexie `rw` transaction that sets `updated_at`,
  `updated_by` and upserts an `outbox` entry. No component writes Dexie directly.
- Speech (T11) comes after the study UI (T09) so the study screen can already be tested without audio; T11
  wires autoplay into it.
- Decisions affecting this phase (see `dev/impl/00-overview.md`): D2 (`practice` flag, T08), D3 (settings
  fields `default_directions`, `show_ipa_on_front`, T01), D4 (no mode chips on Today), D5 (minimal streak in
  T10), D9 (local JSON restore in T06), D10 (`normalizeFront` in T03).
- Soft deletes everywhere; deleting a deck also soft-deletes its cards (§6.1).
- All strings through `react-i18next` with keys in `en.json` and `ru.json`; Russian plurals.
- Run Playwright in the **WebKit** project for every client flow.

## Phase acceptance

From `docs/plan.md`:

- On a real iPhone (installed PWA, airplane mode): import a 300-word CSV, study a session with swipes and audio,
  close the app, reopen — progress is intact.
- Next day the due queue contains the expected cards.
- UI fully usable in Russian and English.
- E2E tests (WebKit) cover onboarding, import, study session, undo.
