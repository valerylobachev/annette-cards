# P1-T05 — CSV import

## Context

Cards can be created one by one (P1-T03) and browsed (P1-T04). The owner's real vocabulary lives in CSV/TSV
files, so bulk import is the fastest way to get to daily study. This task builds the parser (in a Web Worker,
PapaParse) and the four-step Import wizard (S-10) with column auto-mapping, validation, duplicate strategies
and batched inserts. Duplicate detection reuses `normalizeFront` from P1-T03.

## Read first

- `CLAUDE.md` (always)
- `README.md` → "Import format" (columns and example)
- `docs/architecture.md` §4.1 (CSV parsing lives in domain), §4.3, §9 (field length limits)
- `docs/ui_ux.md` S-10
- `docs/use_cases.md` UC-10 (incl. alternatives 3a, 5a, 7a)
- `docs/tech_stack.md` → PapaParse

## Scope

From `docs/plan.md` §1.3:

- [ ] CSV/TSV parser in a Web Worker (PapaParse): delimiter/header detection, UTF-8 check
- [ ] Import wizard (S-10): mapping with auto-detection of header synonyms (EN/RU), validation, duplicates
      strategy, batch insert, result screen

## Out of scope

- JSON backup import and all export (P1-T06).
- "Study now" beyond navigating to `/study?deck=<id>` (study screen is P1-T09).
- Onboarding's "Import a file" entry (P1-T13 links to this wizard).

## Implementation steps

1. `web/src/domain/import/utf8.ts`: `isValidUtf8(bytes: Uint8Array)` using `TextDecoder('utf-8',
   { fatal: true })`; strip BOM. → verify: unit tests with a Windows-1251 sample → invalid.
2. `web/src/domain/import/parse.ts`: wraps PapaParse (`delimiter: ''` auto-detect among `,` `;` `\t`), returns
   `{ delimiter, rows: string[][], hasHeaderGuess }`. Header guess: first row matches ≥ 2 known synonyms.
3. `web/src/domain/import/mapping.ts`: `FIELDS = front, back, example, example_translation, ipa, tags, notes,
   ignore`; `autoMap(headers)` with synonyms (case/NFC-insensitive), at minimum: front ← `front, word, term,
   слово`; back ← `back, translation, meaning, перевод`; example ← `example, sentence, пример`;
   example_translation ← `example_translation, перевод примера`; ipa ← `ipa, transcription, транскрипция`;
   tags ← `tags, теги`; notes ← `notes, comment, заметки`. Without header: column 1 → front, 2 → back.
4. `web/src/domain/import/validate.ts`: per row → `ready | duplicate | error` with reasons
   (`missing_front`, `missing_back`, `too_long`); tags split by spaces or `;`; duplicates by `normalizeFront`
   against existing deck cards **and** earlier rows in the same file. Error report as CSV text
   (`row, reason`).
5. `web/src/features/import/import.worker.ts`: runs UTF-8 check, parse, and validation off the main thread,
   posting progress messages; use Vite's `new Worker(new URL(...), { type: 'module' })`.
6. Repository `web/src/db/importCards.ts`: `importRows(deck_id, rows, strategy)` where strategy is
   `skip | update | import_anyway`; inserts in batches of 500, **one Dexie transaction per batch**, each card
   stamped, states via `ensureStatesForCard`, outbox entries. `update` overwrites fields of the existing card
   (keeps its states). Returns counts. Reports progress between batches.
7. Wizard `web/src/features/import/ImportWizardPage.tsx` at `/import?deck=<id>` (full-screen):
   1) Source — file picker (`accept=".csv,.tsv,.txt"`) or paste textarea; target deck (existing or create new
   with languages, reusing the P1-T02 deck form);
   2) Preview & mapping — detected delimiter, "First row is a header" toggle, first 10 rows table, dropdown per
   column;
   3) Validation — counts ready / duplicates / errors, duplicate strategy radio, "Download error report",
   blocked with explanation when 0 rows are importable (UC-10 5a);
   4) Result — "Imported 312 cards into *English B2*", buttons "Study now" (`/study?deck=<id>`) and
   "Open deck".
   Progress bar for parsing and insertion.
8. Non-UTF-8 file → error "Save the file as UTF-8 and try again" (UC-10 3a).
9. Wire entry points: Decks empty state, deck overflow "Import into deck", deck detail empty state.
10. i18n keys under `import.*`.

## Tests

- Vitest: README example row parses to all 7 fields; `;`-delimited and TSV files detected; quoted field with
  comma and newline preserved.
- Vitest: `autoMap(['Слово', 'Перевод', 'Пример'])` → front, back, example; unknown header → ignore.
- Vitest: validation — missing back → error with row number (1-based, header excluded); duplicate within file
  and against deck; `too_long` for 501-char front.
- Vitest (fake-indexeddb): 1 200 rows → 3 batches; `skip` leaves existing card unchanged; `update` changes
  back but keeps states; every inserted card has states for active directions and outbox entries.
- Playwright (WebKit): import `tests/e2e/fixtures/words-300.csv` into a new deck → result shows 300; open deck
  shows 300 cards. Also a cp1251 fixture → UTF-8 error.

## Invariants to respect

- Parsing and validation in `src/domain/` (pure), run inside a Worker; writes only via repositories.
- Batched transactions each stamp rows and add outbox entries.
- No hardcoded strings; works offline.

## Rust learning notes

n/a (web-only task).

## Docs to update

- `README.md` "Import format": list the recognized header synonyms (EN/RU) and the no-header default.
- `docs/ui_ux.md` S-10: document the exact duplicate strategies and error report format if they differ.
- `docs/plan.md`: tick both §1.3 checkboxes above.

## Definition of done

- [ ] All scope items implemented
- [ ] Tests written and passing: `just test`, `just e2e` (WebKit)
- [ ] `just lint` clean
- [ ] Works offline in WebKit
- [ ] Docs updated as listed above; plan.md checkboxes ticked
- [ ] Committed: `feat(web): CSV/TSV import wizard with worker parsing and batch insert`

## If unclear

If anything in this task is ambiguous or conflicts with the docs, stop and ask before implementing.
