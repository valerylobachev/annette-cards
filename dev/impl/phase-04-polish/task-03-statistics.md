# P4-T03 — Statistics

## Context
All four study modes now write `review_log` rows with `mode`, `rating`, `duration_ms`, `state_before` and the
`practice` flag (D2). The Statistics tab has been a placeholder since Phase 0, and Today shows a streak computed
by the minimal `web/src/domain/streak.ts` from P1-T10 (decision D5). This task builds the Statistics screen (S-13)
and completes the streak logic so Today and Statistics agree.

## Read first
- `CLAUDE.md` (always)
- `docs/architecture.md` §4.2 (Dexie indexes: `review_log` by `reviewed_at`, `card_states` by `due`/`state`),
  §4.4 (day boundary `day_start_hour`), §4.6 (dates/numbers via `Intl`), §5.4 (`card_states`, `review_log`)
- `docs/ui_ux.md` S-13 Statistics, S-04 streak row, §9 localization notes (plurals)
- `docs/use_cases.md` UC-19
- `docs/tech_stack.md` → Recharts, date-fns

## Scope
From `docs/plan.md` 4.2:
- [ ] Statistics screen (S-13): reviews per day, forecast, states, retention, time, heatmap, KPIs
- [ ] Streak logic based on study days

## Out of scope
- Server-side statistics or any API call — statistics are computed locally from Dexie.
- FSRS optimization display → P4-T05.
- Performance tuning beyond reasonable memoization → P4-T06 measures with 10 000 cards.

## Implementation steps
1. Add Recharts (`pnpm add recharts`) — already listed in `tech_stack.md`. → verify: `pnpm tsc --noEmit`.
2. Create pure `web/src/domain/stats.ts` (no Dexie, no React). Inputs are plain arrays plus
   `{ now, dayStartHour, timeZone }`:
   - `reviewsPerDay(logs, range)` → `{ day, again, hard, good, easy }[]` (stacked by rating).
   - `dueForecast(states, days = 30)` → `{ day, count }[]` for the next 30 study days.
   - `stateDistribution(states)` → `{ new, learning, young, mature }` where learning = Learning + Relearning,
     young = Review with `scheduled_days < 21`, mature = Review with `scheduled_days ≥ 21`.
   - `retention(logs)` → % of Good + Easy among logs whose `state_before.state` is Review, **excluding practice
     logs**.
   - `timePerDay(logs, range)` → minutes from `duration_ms`.
   - `kpis(...)` → total cards, mature cards, current streak, longest streak.
   All helpers ignore soft-deleted logs/states and cards of deleted decks. → verify: `pnpm vitest run
   src/domain/stats`.
3. Complete `web/src/domain/streak.ts` (owns the checkbox): `studyDayOf(ts, dayStartHour, timeZone)`,
   `studyDays(logs)` (set of study-day keys with ≥ 1 non-deleted log, practice included),
   `currentStreak(days, today)` (today not yet studied does not break the streak; yesterday missing does),
   `longestStreak(days)`. Reuse the study-day helper from P1-T07 instead of duplicating it. Today's streak row
   must call the same function. → verify: unit tests below; Today E2E still passes.
4. Repository hook `useStatsData({ period, deckId })` in `web/src/features/stats/`: `useLiveQuery` with
   `review_log.where('reviewed_at').above(from)` and `card_states` (+ cards for deck filter); compute via
   `useMemo`. → verify: fake-indexeddb test for the deck filter.
5. Statistics screen (S-13) in `web/src/features/stats/`: period switcher 7 days / 30 days / 1 year, deck filter
   (All + non-archived decks), charts: reviews per day (stacked bar; colors green/red/amber/blue from the visual
   language plus a legend — never color only), forecast (bar), states (bar or donut), retention (line), time per
   day (bar); KPI tiles; calendar heatmap of study days for the 1-year view (small in-house SVG grid, no new
   dependency). Axis labels and dates via `Intl` with the UI locale; plurals via i18next. → verify: component
   test renders with fixture data; Playwright WebKit screenshot of the tab.
6. Empty state: "No reviews yet" + button to Today. → verify: component test with empty data.
7. i18n keys `stats.*` in `en.json` and `ru.json` (Russian plurals for "days", "cards", "minutes"). → verify:
   `just lint`.

## Tests
- Day boundary: a review at 03:30 local with `day_start_hour = 4` belongs to the previous study day; 04:00
  belongs to the current one.
- Streak: studied yesterday and the day before, not yet today → current streak 2; missed yesterday → 0 (or 1 if
  studied today); longest streak over a gap; practice-only day counts as a study day; soft-deleted (undone) log
  alone does not count.
- Time zone change between days (e.g. `Europe/Riga` → `Europe/Warsaw`) does not create a fake gap.
- State distribution: `scheduled_days` 20 → young, 21 → mature.
- Retention excludes practice logs and non-Review `state_before`.
- Forecast counts overdue cards on day 0.
- Deck filter excludes other decks and deleted decks.

## Invariants to respect
- Offline-first: statistics read only from Dexie through repositories/hooks; no API calls.
- Pure logic in `src/domain/` unit-tested without React or Dexie.
- No hardcoded UI strings; dates/numbers through `Intl`.

## Docs to update
- `docs/ui_ux.md` S-13: exact definitions (young/mature threshold, retention excludes practice, heatmap intensity
  buckets); S-04: streak semantics.
- `docs/architecture.md` §4.4: short "Statistics and streak" paragraph (study-day based, practice counts for
  streak but not retention).
- `docs/plan.md`: tick both 4.2 checkboxes.

## Definition of done
- [ ] All scope items implemented
- [ ] Tests written and passing: `just test` and `just e2e` (WebKit)
- [ ] `just lint` clean
- [ ] Works offline in WebKit
- [ ] Docs updated as listed above; plan.md checkboxes ticked
- [ ] Committed: `feat(web): add statistics screen and study-day streaks`

## If unclear
If anything in this task is ambiguous or conflicts with the docs, stop and ask before implementing.
