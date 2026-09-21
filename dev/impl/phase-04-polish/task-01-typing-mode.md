# P4-T01 — Typing mode

## Context
Phases 1–3 are complete: the owner studies with swipe cards (Mode A) offline, data syncs, server audio and AI
enrichment work. The session shell (S-11: start gate, progress, counters, undo, resume) and the answer
transaction (`card_states` update + append `review_log` with `mode` + outbox) already exist. This task adds the
first new exercise, **typing** (Mode D), and the pure answer-checking module that the listening mode (P4-T02)
will reuse. Typing is the most effective recall exercise for spelling, and Polish diacritics make tolerant
checking essential.

## Read first
- `CLAUDE.md` (always)
- `docs/architecture.md` §4.4 (answer → rating mapping; **Typing normalization and tolerance**; answer
  transaction; undo), §4.5 (speech, to speak the correct answer)
- `docs/ui_ux.md` S-11 common layout and **Mode D — Typing**; §2 (input font ≥ 16 px), §8 accessibility
- `docs/use_cases.md` UC-15, UC-17
- `docs/tech_stack.md` → "String distance: small in-house Damerau–Levenshtein in `domain/`" (no dependency)

## Scope
From `docs/plan.md` 4.1:
- [ ] Typing mode: normalization, Damerau–Levenshtein tolerance, diacritics-insensitive near miss, diff highlight

## Out of scope
- Multiple choice, listening mode, the mode selector on Today → P4-T02. In this task typing is reachable via the
  existing deep link `/study?mode=typing` (and `&deck=<id>`).
- Statistics per mode → P4-T03.
- Changing `normalizeFront` used for duplicate detection (P1-T03) — reuse it inside the new normalization, do not
  change its behavior.

## Implementation steps
1. Create `web/src/domain/answer.ts` with pure functions:
   - `normalizeAnswer(text: string, opts: { ignoreLeading?: string[] }): string` — Unicode NFC, trim,
     lowercase, collapse inner whitespace, strip surrounding punctuation (`.,!?;:"'«»()`), optionally drop one
     leading article/particle from `['to', 'the', 'a']` (default on for English target languages).
   - `stripDiacritics(text: string): string` — NFD, remove combining marks, plus explicit map for letters that do
     not decompose (`ł→l`, `Ł→L`, `ø→o`, `đ→d`).
   - `damerauLevenshtein(a: string, b: string): number` — optimal string alignment variant (adjacent
     transpositions count as 1).
   - `checkTypedAnswer(expected: string[], given: string, lang: string): TypedResult` where
     `TypedResult = { verdict: 'exact' | 'near' | 'wrong'; matched: string | null; diff: DiffSegment[] }` and
     `DiffSegment = { kind: 'same' | 'missing' | 'extra' | 'diacritic'; text: string }`.
   - Rules (architecture §4.4): exact after normalization → `exact`; near miss if distance ≤ 1 for answers up to
     6 characters, ≤ 2 for longer, **or** equal after `stripDiacritics` → `near`; else `wrong`. The threshold uses
     the length of the normalized expected answer.
   → verify: `pnpm vitest run src/domain/answer` passes.
2. Add `typedRating(verdict)` next to the existing swipe rating mapping: `exact → Good (3)`, `near → Hard (2)`,
   `wrong → Again (1)`; "I don't know" → Again. → verify: unit test for the mapping table.
3. Decide expected answers per direction (record in `docs/ui_ux.md` S-11 Mode D):
   - `reverse` state (prompt = translation): expected = `[card.front]`.
   - `forward` state (prompt = studied word): expected = meanings of `card.back` split by `;` (any one matches).
   The input gets `lang` = `deck.target_lang` for reverse, `deck.native_lang` for forward.
   → verify: unit test builds expected answers for both directions.
4. Create `web/src/features/study/modes/TypingExercise.tsx`: prompt, auto-focused input (font-size ≥ 16 px,
   `autocapitalize="off"`, `autocorrect="off"`, `spellcheck={false}`), **Check** button and Enter, "I don't know"
   link. Results:
   - `exact` → green state, auto-advance (≈ 600 ms).
   - `near` → amber, diff highlighting from `DiffSegment[]` (missing/extra letters; missing diacritics shown as
     the correct letter, e.g. `ż`), **Continue**.
   - `wrong` → red, correct answer shown and spoken via the existing speech/audio service, **Continue**.
   → verify: component test renders all three states.
5. Plug the exercise into the session shell: `mode = 'typing'` from the route search param; the answer
   transaction is called with `mode: 'typing'` and the rating from step 2; `duration_ms` measured from prompt
   shown to Check. Undo works exactly as in swipe mode. → verify: Playwright WebKit test on
   `/study?mode=typing`.
6. Add i18n keys under `study.typing.*` (`check`, `dontKnow`, `continue`, `almost`, `correctAnswer`,
   `placeholder`) in `en.json` and `ru.json`; VoiceOver labels announce the verdict (`aria-live="polite"`).
   → verify: `pnpm tsc --noEmit`; no hardcoded strings (grep the new component).

## Tests
- `normalizeAnswer`: `"  To Take  Off! "` → `"take off"`; `"The house."` → `"house"`; NFC vs NFD input of `żółw`
  normalize equal; option to keep leading articles.
- `stripDiacritics`: `żółw` → `zolw`, `łódź` → `lodz`, `Zażółć gęślą jaźń` → `zazolc gesla jazn`.
- `damerauLevenshtein`: `("abc","abc")=0`, `("abc","acb")=1` (transposition), `("kitten","sitting")=3`,
  empty strings.
- Thresholds: `house` vs `hause` (5 chars, distance 1) → `near`; `house` vs `huose` → `near` (transposition);
  `house` vs `hxxse` (distance 2, ≤ 6 chars) → `wrong`; `beautiful` vs `beatuiful` → `near`;
  `beautiful` vs `bxautifxl` (distance 2, > 6 chars) → `near`; `beautiful` vs `beaxxxful` → `wrong`.
- Diacritics: expected `żółw`, typed `zolw` → `near` with `diacritic` segments; typed `żółw` → `exact`.
- Multiple meanings: back `взлетать; снимать (одежду)`, typed `взлетать` → `exact`, `matched = 'взлетать'`.
- Rating mapping incl. "I don't know" → Again; review log row has `mode = 'typing'`.
- E2E (WebKit): exact answer auto-advances; near miss shows amber + Continue; undo restores the previous card.

## Invariants to respect
- Offline-first: no server calls; everything uses repositories and pure domain code.
- Answer transaction is atomic (state + `review_log` + outbox); `review_log` stays append-only (undo = soft delete).
- FSRS runs on the client; no hardcoded UI strings (`en.json` + `ru.json`).

## Docs to update
- `docs/architecture.md` §4.4: document the per-direction expected answers and the exact punctuation set /
  article list used.
- `docs/ui_ux.md` S-11 Mode D: expected answer per direction; auto-advance delay.
- `docs/use_cases.md` UC-15: note that forward typing accepts any `;`-separated meaning.
- `docs/plan.md`: tick the Typing mode checkbox in 4.1.

## Definition of done
- [ ] All scope items implemented
- [ ] Tests written and passing: `just test` and `just e2e` (WebKit)
- [ ] `just lint` clean
- [ ] Works offline in WebKit
- [ ] Docs updated as listed above; plan.md checkbox ticked
- [ ] Committed: `feat(web): add typing study mode with tolerant answer checking`

## If unclear
If anything in this task is ambiguous or conflicts with the docs (for example the per-direction expected answer
in step 3), stop and ask before implementing.
