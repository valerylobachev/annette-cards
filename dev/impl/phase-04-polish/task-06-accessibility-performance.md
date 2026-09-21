# P4-T06 — Accessibility and performance

## Context
All screens and study modes now exist (Phases 1–4 up to P4-T05). Phase 1 already added button equivalents for
swipes, VoiceOver labels on study cards and reduced-motion variants. This task is a measure-and-fix pass across
the whole app: accessibility (VoiceOver, dynamic type, contrast) and performance with a 10 000-card deck. It also
answers the open question about the 1 GB SQLite limit (`architecture.md` §15) with real numbers.

## Read first
- `CLAUDE.md` (always; iOS / Safari gotchas)
- `docs/ui_ux.md` §1 (principles), §2 (visual language: ≥ 16 px inputs, 44×44 targets), §7 (very long text), §8
  Accessibility, S-06 (virtualized list for 5 000+ cards), S-10 (large files in a Web Worker)
- `docs/architecture.md` §4.2 (Dexie indexes), §4.4 (session queue), §14 ADR-6, §15 open questions
- `docs/tech_stack.md` → Playwright, Vitest; Database → audio storage

## Scope
From `docs/plan.md` 4.5:
- [ ] Accessibility pass (VoiceOver, dynamic type, contrast)
- [ ] Performance pass: 10 000 cards deck — list scroll, session build < 100 ms, import < 10 s
- [ ] Measure database size with audio and record the 1 GB decision (`architecture.md` §15) (added)

## Out of scope
- New features or redesigns; fix only what the audit finds.
- Purge job and documentation refresh → P4-T07.

## Implementation steps
1. Test data: add `web/tests/fixtures/generate-cards.ts` producing a 10 000-row CSV (import format columns from
   README) and a helper that seeds Dexie with 10 000 cards, 20 000 `card_states` and 100 000 `review_log` rows
   for unit benchmarks. → verify: script runs and the CSV has 10 001 lines.
2. Session build benchmark: Vitest test that runs the session builder from `domain/session.ts` over the seeded
   data (loaded from fake-indexeddb as plain arrays and via the real repository query) and asserts median
   < 100 ms (report the number). Fix by using indexed Dexie queries (`card_states.where('due').belowOrEqual(now)`,
   `where('state').equals(0)`) instead of full-table scans. → verify: test passes; numbers recorded.
3. Import benchmark: Playwright WebKit test imports the 10 000-row CSV through S-10 and asserts completion < 10 s
   (parse in the worker + batched inserts of 500). Fix hot spots (e.g. duplicate check with an in-memory `Set`
   of normalized fronts instead of a query per row). → verify: E2E passes; time recorded.
4. List scroll: Playwright WebKit opens S-06 for the 10 000-card deck, scrolls to the end; assert the number of
   rendered rows stays bounded (virtualization) and search/sort respond < 200 ms. Check Statistics (P4-T03)
   renders < 500 ms with 100 000 logs. → verify: E2E passes; numbers recorded.
5. Accessibility automation: add `@axe-core/playwright` (dev dependency; add to `tech_stack.md`), run axe on every
   main route (Today, Decks, Deck detail, Card view, Editor, Import, Study start gate + each mode, Summary,
   Statistics, Settings, Account & sync, Voices, Onboarding) in light and dark themes; fix all serious/critical
   violations, especially contrast ≥ 4.5:1 and missing labels. → verify: `just e2e` a11y spec is green.
6. Dynamic type: make the root font size follow iOS text-size settings (`font: -apple-system-body` on `html`
   with a rem-based scale; fallback 16 px); check 200 % (Playwright with a larger root font) — no clipped text,
   cards scroll, tab bar labels wrap or truncate with accessible names. → verify: screenshots at 100 % / 200 %.
7. Manual VoiceOver pass on a real iPhone: study each mode, deck list swipe actions (rotor/custom actions exist
   for Archive/Delete), sheets trap focus, snackbar announces with `aria-live`. Record a short checklist result in
   the commit description. → verify: checklist completed.
8. 1 GB decision: on the VPS (or with a local copy of the DB) measure `SELECT count(*), avg(length(bytes)),
   sum(length(bytes)) FROM audio_assets`; extrapolate for the expected vocabulary (users × cards with audio);
   decide keep BLOBs vs move to object storage, and record the decision in `architecture.md` §15 → §14 (new ADR
   or updated ADR-6). → verify: numbers and decision written in docs.

## Tests
- Session build: 10 000 cards, `new_per_day = 15`, `max_reviews_per_day = 200` → queue ≤ 215 entries in < 100 ms.
- Import: 10 000 rows, 5 % duplicates with "Skip" → correct counts in the result screen within 10 s.
- Virtualized list: rendered row count < 100 at any scroll position.
- axe: zero serious/critical violations on all listed routes in both themes.
- Dynamic type 200 %: study card with a 200-character front still shows the answer buttons without overlap.

## Invariants to respect
- Offline-first: benchmarks run against local Dexie; no API calls from UI.
- All swipe actions keep button equivalents; color is never the only signal.
- No hardcoded UI strings when adding accessible labels (`aria-label` values come from i18n).

## Docs to update
- `docs/ui_ux.md` §8: dynamic type implementation, axe gate, VoiceOver custom actions.
- `docs/architecture.md` §14/§15: 1 GB decision with measured numbers; §4.4: note on indexed queries if changed.
- `docs/tech_stack.md`: `@axe-core/playwright`; Database → audio storage row updated with the decision.
- `docs/plan.md`: tick both 4.5 checkboxes covered here and the added item.

## Definition of done
- [ ] All scope items implemented; measured numbers recorded in the commit description and docs
- [ ] Tests written and passing: `just test` and `just e2e` (WebKit)
- [ ] `just lint` clean
- [ ] Works offline in WebKit
- [ ] Docs updated as listed above; plan.md checkboxes ticked
- [ ] Committed: `perf(web): accessibility and 10k-card performance pass`

## If unclear
If a target cannot be met without an architectural change (e.g. a different Dexie schema version), stop and ask
before implementing.
