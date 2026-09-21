# P4-T02 — Choice and listening modes

## Context
P4-T01 added typing (Mode D) and `web/src/domain/answer.ts`. Swipe (Mode A) has existed since Phase 1, and
Phase 3 added the audio playback chain (cached MP3 → download + cache → system voice). This task adds
**multiple choice** (Mode B) and **listening** (Mode C) and finally the **mode selector** on Today, which Phase 1
deliberately left out (decision D4). After this task all four modes from S-11 are available from Today.

## Read first
- `CLAUDE.md` (always)
- `docs/architecture.md` §4.4 (answer → rating mapping: Multiple choice and Listening → Again / Good), §4.5
  (speech and audio playback chain, `rate`), §5.4 `review_log.mode` (`'swipe' | 'choice' | 'listen' | 'typing'`),
  §5.5 settings document
- `docs/ui_ux.md` S-04 (mode chips under Start), S-11 **Mode B — Multiple choice**, **Mode C — Listening**,
  S-14 Study/Audio sections
- `docs/use_cases.md` UC-08 (step 2), UC-14
- `dev/impl/phase-04-polish/task-01-typing-mode.md` (reused `checkTypedAnswer`)

## Scope
From `docs/plan.md` 4.1:
- [ ] Multiple choice with smart distractors
- [ ] Listening mode (auto-play, slower replay, choose/type)
- [ ] Mode selector on Today; mode stored in review log
- [ ] `listening_answer: 'choose' | 'type'` setting (default `'choose'`) in the settings document and S-14 (added)

## Out of scope
- Statistics broken down by mode → P4-T03 may use `mode`, but no per-mode charts are required.
- Any server change: modes are client-only; `review_log.mode` already exists on the server.
- New audio features (generation, prefetch) — use the P3-T03 playback service as is.

## Implementation steps
1. Create `web/src/domain/distractors.ts`:
   `pickDistractors(target: Card, pool: Card[], field: 'front' | 'back', count = 3, rng): Card[]`.
   Ranking: same deck first, then shared tags, then similar length (|len diff| small); exclude the target, cards
   with the same normalized value (`normalizeFront`) and soft-deleted cards; deterministic with an injected
   `rng` for tests. If the deck has fewer than 4 usable cards, fill from other non-archived decks with the same
   `target_lang`; if still fewer than 3 distractors → return what exists and let the caller mark the mode
   unavailable. → verify: `pnpm vitest run src/domain/distractors`.
2. Add a repository query `listDistractorPool(deckId, targetLang)` in `web/src/db/` (non-deleted cards of the deck
   plus same-language decks; read-only). → verify: fake-indexeddb test.
3. `web/src/features/study/modes/ChoiceExercise.tsx`: prompt on top (studied word for `forward`, translation for
   `reverse`), four large option buttons (≥ 44 px, shuffled). Correct → option green, 600 ms delay, next.
   Wrong → chosen red, correct green, card details shown, **Continue**. Rating: correct → Good, wrong → Again;
   `mode: 'choice'`. → verify: component test for correct and wrong paths.
4. `web/src/features/study/modes/ListeningExercise.tsx`: large speaker button auto-plays on card show (the
   session start gate already unlocked speech), **Play slower** uses rate 0.7 (system voice) or
   `playbackRate = 0.7` (MP3). Answer by `settings.listening_answer`:
   - `'choose'` → four written options of `front` (reuse `pickDistractors` with `field: 'front'`);
   - `'type'` → reuse the typing input and `checkTypedAnswer([card.front], …)`; `near` → Hard.
   Rating per architecture §4.4; `mode: 'listen'`. Listening always asks for the studied word regardless of
   direction; record this in `docs/ui_ux.md` S-11 Mode C. → verify: component test with a mocked speech service.
5. Mode availability: if `pickDistractors` cannot supply 3 distractors for the session's cards, the Choice and
   Listening(choose) chips are disabled with a hint (`study.modes.notEnoughCards`). → verify: unit test for the
   availability helper; E2E with a 2-card deck shows the disabled chip.
6. Today (S-04): chips under **Start**: Swipe (default), Choice, Listening, Typing. The selected mode is a
   device-local preference in `meta` (`study_mode`), passed to `/study?mode=<mode>` and to "Decks due" starts.
   → verify: Playwright WebKit selects Choice and the session shows four options.
7. Settings: add `listening_answer` to the settings type and defaults, and a row in S-14 Study
   ("Listening: choose / type"). A settings write goes through the settings repository (outbox). → verify:
   repository test that the new default is filled for old settings rows.
8. i18n keys `study.modes.*`, `study.choice.*`, `study.listening.*`, `settings.study.listeningAnswer.*` in
   `en.json` and `ru.json`. → verify: `just lint`.

## Tests
- Distractors: never include the target or duplicates; prefer same tags; similar length wins over random when
  tags are equal; 3-card deck is filled from another deck with the same `target_lang` but not from a deck with
  another language; archived/deleted cards excluded.
- Fewer than 4 cards in total for the language → mode unavailable (UC-14 alternative).
- Choice: correct → rating Good, log `mode = 'choice'`; wrong → Again and "Continue" required.
- Listening: auto-play is called once per card; "Play slower" calls with rate 0.7; `type` variant with `zolw`
  for `żółw` → Hard; log `mode = 'listen'`.
- Mode selector persists across reloads (device-local) and undo works in every mode.
- E2E (WebKit, offline context): a Choice session and a Listening session complete and update Today counters.

## Invariants to respect
- Offline-first: all reads via repositories; listening falls back to the system voice when MP3 is not cached.
- Every settings mutation sets `updated_at`, `updated_by` and an outbox entry in one transaction.
- `review_log` append-only; FSRS on the client; no hardcoded UI strings.
- iOS: speech must follow a user gesture — rely on the existing start gate; never auto-play before it.

## Docs to update
- `docs/architecture.md` §5.5: add `"listening_answer": "choose"`; §4.2: `study_mode` in device-local `meta`.
- `docs/ui_ux.md` S-04 (mode chips now live, persistence per device), S-11 Modes B and C (distractor rules,
  listening always targets the studied word, unavailability hint), S-14 (listening answer row).
- `docs/use_cases.md` UC-14: fallback behavior as implemented.
- `docs/plan.md`: tick the three 4.1 checkboxes above and the added setting checkbox.

## Definition of done
- [ ] All scope items implemented
- [ ] Tests written and passing: `just test` and `just e2e` (WebKit)
- [ ] `just lint` clean
- [ ] Works offline in WebKit
- [ ] Docs updated as listed above; plan.md checkboxes ticked
- [ ] Committed: `feat(web): add multiple-choice and listening modes with mode selector`

## If unclear
If anything in this task is ambiguous or conflicts with the docs, stop and ask before implementing.
