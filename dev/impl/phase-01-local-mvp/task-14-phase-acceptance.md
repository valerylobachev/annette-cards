# P1-T14 — Phase 1 acceptance

## Context

All Phase 1 tasks (P1-T01…P1-T13) are implemented: data layer, decks and cards, import/export, study engine,
swipe study UI, Today and summary, speech, settings, onboarding and offline support. This task verifies the
phase's acceptance criteria from `docs/plan.md` end to end, on automated tests and on a real iPhone, fixes any
gaps found, and updates the project status. It adds **no new features**.

## Read first

- `CLAUDE.md` (always) — definition of done, iOS / Safari gotchas
- `docs/plan.md` → Phase 1 "Acceptance"
- `dev/impl/phase-01-local-mvp/00-phase-overview.md`
- `docs/use_cases.md` UC-01, UC-08, UC-10, UC-11, UC-17, UC-18, UC-26, UC-27

## Scope

From `docs/plan.md`, Phase 1 **Acceptance**:

- On a real iPhone (installed PWA, airplane mode): import a 300-word CSV, study a session with swipes and audio,
  close the app, reopen — progress is intact.
- Next day the due queue contains the expected cards.
- UI fully usable in Russian and English.
- E2E tests (WebKit) cover onboarding, import, study session, undo.

## Out of scope

- Any new feature or refactoring not needed to pass acceptance. Record ideas in the Backlog instead.
- Server work (Phase 2).

## Implementation steps

1. Confirm every Phase 1 checkbox in `docs/plan.md` is ticked; list any that are not and finish or report them.
   → verify: `grep -n '\- \[ \]' docs/plan.md` shows no Phase 1 items.
2. Run the full suite: `just lint`, `just test`, `just e2e`. → verify: all green, WebKit project included.
3. E2E coverage check: make sure specs exist and pass for onboarding, import (300-row fixture), study session
   (swipe + buttons), undo. Add missing specs (tests only). → verify: `just e2e` lists them.
4. i18n completeness: add a Vitest test that `en.json` and `ru.json` have identical key sets (incl. plural
   suffixes `_one/_few/_many/_other` for Russian where English has `_one/_other`). Walk through every screen in
   both languages (Playwright screenshots in `web/tests/e2e/i18n.spec.ts`) and fix truncated or missing strings.
   → verify: test passes; screenshots reviewed.
5. Next-day check (automated): Playwright spec with a mocked clock (`page.clock`) — study 10 new cards with
   Good, advance past `day_start_hour` of the next study day, open Today → due count matches cards whose
   `due` is before now; compare with a direct `buildSession` call.
6. Production build: `just build` → run the binary locally → open in Safari/WebKit → install flow works,
   service worker precaches.
7. Real iPhone checklist (manual, owner performs; document results in the commit message body or a short note
   in `docs/plan.md` under the acceptance paragraph):
   - [ ] Open the app over HTTPS (`just dev-https` or deployed preview), Add to Home Screen, launch standalone.
   - [ ] Onboarding in Russian; storage persistence requested.
   - [ ] Airplane mode on. Import a 300-word CSV (via Files).
   - [ ] Study a session with swipes; audio via system voice (Start gate unlocks speech); undo once.
   - [ ] Force-close the app, reopen → progress intact, Today counts consistent.
   - [ ] Next day: due queue contains the expected cards.
   - [ ] Switch UI to English; all screens readable; switch back.
8. Fix any defect found with the smallest change plus a regression test.
9. Update `README.md` Status: "Phase 1 (local MVP) complete — the app works fully offline on iPhone; backend and
   sync come in Phase 2."

## Tests

- New or updated only where acceptance gaps exist: i18n key parity test, next-day due test, any regression
  tests for defects found.

## Invariants to respect

- All CLAUDE.md invariants; this task must not weaken any of them to make a test pass.

## Rust learning notes

n/a (web-only phase).

## Docs to update

- `README.md`: Status line (step 9).
- `docs/plan.md`: tick the phase acceptance (add a `- [x] Acceptance verified on <date>` line under the
  Phase 1 Acceptance paragraph).
- Any doc whose behavior description turned out to be wrong during the walkthrough.

## Definition of done

- [ ] All acceptance criteria verified (automated + manual iPhone checklist)
- [ ] Tests passing: `just test`, `just e2e` (WebKit mandatory)
- [ ] `just lint` clean
- [ ] Works offline in WebKit and on a real iPhone
- [ ] Docs updated as listed above; plan.md acceptance line ticked
- [ ] Committed: `chore: verify Phase 1 acceptance`

## If unclear

If anything in this task is ambiguous or conflicts with the docs, stop and ask before implementing.
