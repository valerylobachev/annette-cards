# P1-T09 — Study session and swipe cards

## Context

The study engine is complete in the domain and repositories (P1-T07 session builder, P1-T08 answer, undo and
practice). This task builds the heart of the app: the full-screen study session (S-11) with the start gate,
progress, counters, close confirmation, undo and resume within 30 minutes, and Mode A — Duocards-style swipe
cards animated with `motion`. Speech autoplay is added later (P1-T11); keep a hook point for it.

## Read first

- `CLAUDE.md` (always)
- `docs/architecture.md` §4.4 (answer → rating mapping for swipe; learning re-insertion)
- `docs/ui_ux.md` §1 (principles), §2 (colors, card shape), §3 (deep links), S-11 (common layout, start gate,
  Mode A, interruptions), §6 (gestures), §7 ("Very long text on card"), §8
- `docs/use_cases.md` UC-11, UC-17, UC-08 4a, UC-16
- `docs/tech_stack.md` → `motion`

## Scope

From `docs/plan.md` §1.5:

- [ ] Study session shell (S-11): start gate, progress, counters, close confirm, undo, resume within 30 min
- [ ] Swipe cards with `motion`: flip, drag with rotation and overlays, thresholds, buttons alternative,
      simple and detailed answer modes, stack preview
- [ ] (added) Deep link handling `/study?deck=<id>&mode=swipe&practice=1` (validated search params)
- [ ] (added) Long text on a card auto-shrinks down to 20 px, then scrolls inside the card

## Out of scope

- Today screen and session summary (P1-T10) — at queue end navigate to `/study/summary` placeholder.
- Reduced-motion variants and VoiceOver labels (P1-T10) — but do not block them (keep animation variants in
  one place).
- Speech (P1-T11), modes B–D (Phase 4).

## Implementation steps

1. Route `/study` (TanStack Router, typed search params: `deck?: string`, `mode?: 'swipe'` (only swipe in
   Phase 1), `practice?: 1`). Unknown deck id → friendly empty state. Tab bar hidden.
   → verify: router test for param parsing.
2. Session controller `web/src/features/study/useStudySession.ts`: builds the queue once at start
   (`buildSession` or `buildPracticeQueue`), holds `current`, `done`, `total`, counters (New · Learning ·
   Review), `lastLogId` for undo, and applies `answer()` results incl. learning re-insertion. Persist the
   session snapshot (queue ids, position, `lastLogId`, `started_at`, `last_active_at`) to `meta` key
   `study_session` (device-local) after each answer; on open, resume if `now − last_active_at < 30 min`, else
   rebuild. → verify: unit tests with a fake clock.
3. Start gate: deck/mode title and a large **Start** button (this tap will unlock speech on iOS in P1-T11).
4. Top bar: close (×) → Confirm sheet if ≥ 1 answer ("Answers are saved. Leave the session?"); progress bar
   `done / total`; counters; undo (↶) enabled after the first answer → `undoAnswer(lastLogId)` puts the card
   back on top.
5. `web/src/features/study/SwipeCard.tsx` with `motion`:
   - front: forward → `card.front` (+ IPA if `settings.show_ipa_on_front`), reverse → `card.back`;
   - tap flips (3D rotateY, 250 ms) to reveal answer, example, notes;
   - drag: `x` motion value, rotation `x / width * 12°` clamped to ±12°, colored overlay + label "Know" /
     "Again" with opacity proportional to distance; commit when |x| > 35 % of width or |velocity.x| > 600
     px/s, else spring back; swipe up (y < −30 % height or velocity.y < −600) = Easy in detailed mode only;
   - fly-out animation then next card.
6. Answer mapping (`web/src/domain/rating.ts`): simple → left = Again (1), right = Good (3); detailed →
   buttons Again/Hard/Good/Easy, swipe up = Easy (4). Mode `'swipe'` in the log. Measure `duration_ms` from
   card shown to answer. Swiping without flipping is allowed.
7. Buttons under the card (accessible alternative): simple ✗ / ✓; detailed ✗ · Hard · ✓ · Easy
   (`settings.answer_mode`).
8. Stack preview: the next two cards rendered behind (scaled 0.95 / 0.90, offset) without content flash.
9. Auto-shrink text: measure overflow and step the font size from 40 px down to 20 px, then enable
   `overflow-y: auto` inside the card.
10. Queue end → navigate to `/study/summary` with the session id.
11. i18n keys under `study.*`.

## Tests

- Vitest: rating mapping for simple and detailed modes; resume logic (29 min → resume, 31 min → rebuild).
- Testing Library: undo button disabled before the first answer, enabled after; close without answers does not
  show a confirm.
- Playwright (WebKit): seed a deck with 5 new cards → `/study?deck=<id>` → Start → drag right past threshold →
  progress 1/5 → undo → card returns, progress 0/5 → finish with buttons → lands on summary route.
  Drag below threshold springs back without answering.
- Playwright: reload mid-session → resumes at the same position.

## Invariants to respect

- UI writes only through `answer()` / `undoAnswer()` repositories.
- No hardcoded strings; touch targets ≥ 44 px; safe areas respected.
- Works offline (no network calls).

## Rust learning notes

n/a (web-only task).

## Docs to update

- `docs/ui_ux.md` S-11: document the resume snapshot in `meta` and the exact swipe-up threshold if refined.
- `docs/architecture.md` §4.2: add `study_session` to device-local `meta` keys.
- `docs/plan.md`: tick both §1.5 checkboxes above and the two (added) items.

## Definition of done

- [ ] All scope items implemented
- [ ] Tests written and passing: `just test`, `just e2e` (WebKit)
- [ ] `just lint` clean
- [ ] Works offline in WebKit
- [ ] Docs updated as listed above; plan.md checkboxes ticked
- [ ] Committed: `feat(web): study session shell with swipe cards`

## If unclear

If anything in this task is ambiguous or conflicts with the docs, stop and ask before implementing.
