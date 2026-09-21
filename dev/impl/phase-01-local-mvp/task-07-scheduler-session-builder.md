# P1-T07 — Scheduler and session builder

## Context

Cards with New states exist (P1-T02…P1-T06). Nothing decides what to study. This task implements the pure
study-engine core in `web/src/domain/`: a `ts-fsrs` wrapper configured from settings, study-day calculation
with `day_start_hour`, daily counters, and the session queue builder (due first, new interleaved 1:4, limits,
sibling burying, learning re-insertion, extra-new allowance). No Dexie writes happen here; P1-T08 adds the
answer transaction.

## Read first

- `CLAUDE.md` (always)
- `docs/architecture.md` §4.4 (FSRS, Directions, Day boundary, Session queue), §5.5 (settings), §5.4
  `card_states`, `decks.new_per_day`, `decks.archived_at`
- `docs/ui_ux.md` S-04 ("Learn extra new words"), S-11
- `docs/use_cases.md` UC-08 (incl. 1a, 2a), UC-11 step 5
- `docs/tech_stack.md` → `ts-fsrs`, date-fns

## Scope

From `docs/plan.md` §1.4:

- [ ] `ts-fsrs` wrapper with settings (retention, short-term steps, fuzz)
- [ ] Study-day calculation with `day_start_hour`; daily counters (new introduced, reviews done)
- [ ] Session builder: due first, new interleaved 1:4, limits, sibling burying, learning re-insertion
- [ ] (added) Extra-new allowance: "Learn extra new words" raises today's new limit by 10; stored device-local
      in `meta` key `extra_new` = `{ study_day: 'YYYY-MM-DD', count }`

## Out of scope

- Answer transaction, undo, practice queue (P1-T08). The unit-test checkbox of §1.4 is owned by P1-T08, but
  write thorough tests for everything implemented here.
- Any UI.

## Implementation steps

1. `web/src/domain/fsrs.ts`: `createScheduler(settings)` → `fsrs(generatorParameters({ request_retention:
   settings.desired_retention, maximum_interval: 36500, enable_fuzz: true, enable_short_term: true,
   w: settings.fsrs_weights ?? default }))`. Mappers `toFsrsCard(CardState)` / `fromFsrsCard(card, base)`
   between our snake_case state and ts-fsrs `Card` (dates ↔ ms). `nextState(state, rating, now)` returning
   `{ state, log }`. → verify: New card rated Good twice moves to Review with `due` in the future.
2. `web/src/domain/studyDay.ts`: `studyDayOf(ms, day_start_hour, tz?)` → `'YYYY-MM-DD'` in local time (a
   review at 03:30 with `day_start_hour = 4` belongs to the previous day); `studyDayBounds(day)` → `[start,
   end)` ms. Use date-fns. → verify: tests around midnight and DST change dates.
3. `web/src/domain/counters.ts`: from `review_log` rows of the current study day (non-deleted, non-practice
   once P1-T08 adds the flag): `newIntroducedToday` = count of logs whose `state_before.state === 0`,
   `reviewsDoneToday` = the rest.
4. `web/src/domain/session.ts`: `buildSession(input, now)` where input =
   `{ decks, cards, states, logsToday, settings, extraNew, deckFilter? }` → ordered `QueueItem[]`
   (`{ card_id, direction, kind: 'new'|'learning'|'review' }`):
   1) eligible = non-deleted card, non-deleted non-archived deck, direction active for the deck, optional
      `deckFilter`;
   2) due: `due <= now`, state ∈ {Learning, Review, Relearning}, oldest `due` first, up to
      `max_reviews_per_day − reviewsDoneToday`;
   3) new: state New ordered by card `created_at`, up to `limit − newIntroducedToday` where limit =
      `deck.new_per_day ?? settings.new_per_day` per deck (and the global cap `settings.new_per_day` +
      `extraNew`);
   4) interleave one new after every 4 reviews;
   5) bury siblings: if one direction of a card was reviewed today or is already in the queue, drop the other.
5. `web/src/domain/session.ts`: `reinsertLearning(queue, item, nextDue, now)` — if `nextDue − now < 20 min`,
   insert the item at the position where its due time falls (approximate by average 10 s per card), else drop.
6. `web/src/domain/estimate.ts`: `estimateMinutes(queue)` (≈ 8 s per review, 15 s per new) for Today.
7. Data adapter `web/src/db/studyQueries.ts`: loads the inputs for `buildSession` from Dexie (live query
   variant for Today counts) and reads/writes `meta.extra_new` (`addExtraNew(10)` resets when study day
   changes). Meta writes do not create outbox entries.

## Tests

Vitest, pure (inject `now`):
- 30 due reviews + 20 new, limits 200/15 → order R R R R N R R R R N …, 15 new total.
- `reviewsDoneToday = 195`, `max_reviews_per_day = 200` → only 5 reviews.
- Deck override `new_per_day = 5` limits that deck while another deck uses 15.
- Card with both directions New → only one direction today (buried).
- Archived deck and soft-deleted card excluded; disabled direction excluded.
- Day boundary: review at 03:59 counts for yesterday with `day_start_hour = 4`.
- `extraNew = 10` on a day with the new limit exhausted → 10 more new cards; next study day resets.
- `reinsertLearning` with next due in 1 min puts the card back in the queue; 1 day → not reinserted.

## Invariants to respect

- FSRS runs on the client only; domain code is pure (no React, no Dexie in `src/domain/`).
- Device-local `meta` values never create outbox entries.

## Rust learning notes

n/a (web-only task).

## Docs to update

- `docs/architecture.md` §4.4: document the per-deck vs global new-limit rule, the extra-new allowance and the
  `meta.extra_new` key (also list it in §4.2 device-local preferences).
- `docs/plan.md`: tick the three §1.4 checkboxes above and the (added) item.

## Definition of done

- [ ] All scope items implemented
- [ ] Tests written and passing: `just test`
- [ ] `just lint` clean
- [ ] Works offline in WebKit (pure logic, no network)
- [ ] Docs updated as listed above; plan.md checkboxes ticked
- [ ] Committed: `feat(web): FSRS wrapper, study day and session queue builder`

## If unclear

If anything in this task is ambiguous or conflicts with the docs, stop and ask before implementing.
