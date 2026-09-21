# P1-T10 — Today and session summary

## Context

Studying works end to end via `/study` (P1-T09), but the home tab is still a placeholder and a session ends on
an empty summary route. This task builds Today (S-04) — the daily entry point with counts, time estimate, Start,
decks due and streak — and the Session summary (S-12) with "Repeat these now". It also finishes accessibility
of the study UI: reduced-motion variants and VoiceOver labels. Per D4 there are no mode chips yet; per D5 a
minimal current-streak function is added here (Phase 4 completes it).

## Read first

- `CLAUDE.md` (always)
- `docs/architecture.md` §4.4 (Day boundary)
- `docs/ui_ux.md` S-04, S-12, §8 (accessibility), §2 (motion), §9 (plurals, relative time)
- `docs/use_cases.md` UC-08 (incl. 1a, 2a), UC-16, UC-17
- `dev/impl/00-overview.md` → decisions D4, D5

## Scope

From `docs/plan.md` §1.5:

- [ ] Today (S-04): due/new counts, estimate, Start, deck-due list, streak
- [ ] Session summary (S-12) with "Repeat these now"
- [ ] Reduced-motion variants and VoiceOver labels
- [ ] (added) "Learn extra new words" (+10 via `meta.extra_new`) and "Practice difficult words" when nothing is
      due; "Practice difficult" also reachable from deck detail (already linked in P1-T04)
- [ ] (added) Minimal `domain/streak.ts`: current streak in study days (D5)

## Out of scope

- Mode selector chips (P4-T02, D4).
- Longest streak, heatmap, statistics (P4-T03).
- Sync indicator in the top bar (P2-T06) and pull-down to sync.

## Implementation steps

1. `web/src/domain/streak.ts`: `currentStreak(studyDaysWithReviews: string[], today: string)` — consecutive
   study days ending today (or yesterday if nothing studied yet today). Any non-deleted review counts,
   including practice. `last7Days(...)` → booleans for the dots. → verify: unit tests.
2. `web/src/db/studyQueries.ts`: `useTodaySummary()` (live) → `{ reviewsDue, newAvailable, estimateMin,
   decksDue: [{ deck, due }], nextDueAt, streak, last7 }` using `buildSession` counts per deck.
3. `web/src/features/today/TodayPage.tsx`:
   - top bar: greeting (display name placeholder "there" until accounts exist; i18n);
   - hero card: "To review: 42 · New: 15", "≈ 9 min", full-width **Start** → `/study`;
   - nothing due: "Nothing due. Next reviews in 3 h" (relative time) + "Learn extra new words" (calls
     `addExtraNew(10)` then starts) + "Practice difficult words" (`/study?practice=1`);
   - first day (no reviews ever): only new-card count;
   - streak row: flame icon, "12 days" (plural), 7 dots;
   - decks-due list: name, language code (EN/PL), due count → `/study?deck=<id>`;
   - floating "+" (Quick add from P1-T03). Render directly — no skeleton.
4. Summary route `/study/summary` → `web/src/features/study/SummaryPage.tsx`: cards reviewed, accuracy %
   (Good+Easy / all), time spent (sum `duration_ms`), new words learned, streak (updated), "Difficult in this
   session" (Again ≥ 1) with tap → `/cards/<id>`; **Repeat these now** → `/study?practice=1` with those card ids
   (pass via session snapshot in `meta` or search param); **Done** → Today. Data from the finished session's
   log ids.
5. Reduced motion: `useReducedMotion()` from `motion`; replace flip with cross-fade and fly-out with fade in
   `SwipeCard` and card stack; one `studyAnimations.ts` variants module.
6. VoiceOver: card sides labelled ("Word: to take off. Double-tap to reveal translation." / "Translation: …");
   swipe buttons with `aria-label`; progress bar with `role="progressbar"` and values; overlays have text not
   only color; announce result of undo via `aria-live="polite"`.
7. i18n keys under `today.*`, `summary.*`, `a11y.*` with Russian plurals ("1 день / 2 дня / 5 дней").

## Tests

- Vitest: streak — studied today and 11 previous days → 12; gap yesterday → 1; nothing today but yesterday
  → streak continues; day boundary at `day_start_hour`.
- Testing Library: Today with 0 due shows "Learn extra new words"; tapping it increases new count by 10.
- Testing Library: summary accuracy for 3 Good + 1 Again → 75 %.
- Playwright (WebKit): Today → Start → finish 3 cards → summary → Repeat these now opens practice → Done →
  Today counts decreased. Emulate `reducedMotion: 'reduce'` and assert no rotate transform on flip.
- Playwright accessibility snapshot: study card and buttons have accessible names.

## Invariants to respect

- Reads via `useLiveQuery`; writes only via repositories (`meta` for extra-new, no outbox).
- No hardcoded strings; plurals via i18next; relative time via `Intl`.
- Offline-first.

## Rust learning notes

n/a (web-only task).

## Docs to update

- `docs/ui_ux.md` S-04: state that mode chips arrive in Phase 4 (D4); S-12: how "Repeat these now" passes the
  card list.
- `docs/architecture.md` §4.4: describe the streak rule (study days) as implemented (D5).
- `docs/plan.md`: tick the three §1.5 checkboxes above and the two (added) items.

## Definition of done

- [ ] All scope items implemented
- [ ] Tests written and passing: `just test`, `just e2e` (WebKit)
- [ ] `just lint` clean
- [ ] Works offline in WebKit
- [ ] Docs updated as listed above; plan.md checkboxes ticked
- [ ] Committed: `feat(web): Today screen, session summary and study accessibility`

## If unclear

If anything in this task is ambiguous or conflicts with the docs, stop and ask before implementing.
