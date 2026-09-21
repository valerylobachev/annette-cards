# P1-T03 — Card editor and quick add

## Context

Decks exist (P1-T02) and every card write can create per-direction states via `ensureStatesForCard`. There is
no way to add words yet. This task builds the full card editor (S-08) and the Quick add bottom sheet (S-09)
opened from the floating "+" on Today and Decks. It also defines `normalizeFront` (decision D10), the shared
normalization used for duplicate detection here and in CSV import (P1-T05).

## Read first

- `CLAUDE.md` (always)
- `docs/architecture.md` §4.3 (write path), §5.4 `cards` (fields), §9 (field length limits: front/back ≤ 500,
  notes ≤ 2000)
- `docs/ui_ux.md` §3 (floating "+"), S-08, S-09, §2 (inputs ≥ 16 px to avoid iOS zoom)
- `docs/use_cases.md` UC-06, UC-07 (edit, move to another deck)
- `dev/impl/00-overview.md` → decision D10

## Scope

From `docs/plan.md` §1.2:

- [ ] Card editor (S-08): fields, validation, duplicate warning, tag autocomplete, IPA helper row
- [ ] Quick add sheet (S-09) with offline two-field flow
- [ ] (added) `normalizeFront` domain function (NFC, trim, lowercase, collapse spaces) used for duplicate
      detection (D10)

## Out of scope

- "Fill with AI" button and AI suggestions in quick add (P3-T05). Do not render placeholders for them.
- Speaker button next to Front (wired in P1-T11 when the speech service exists).
- Card view and deck detail (P1-T04).

## Implementation steps

1. `web/src/domain/normalize.ts`: `normalizeFront(s)` = `s.normalize('NFC').trim().toLowerCase()` + collapse
   internal whitespace. `web/src/domain/cardValidation.ts`: `validateCardInput(input)` → list of field errors
   (`required`, `too_long`); trims all fields; empty optional fields become `null`; tags trimmed, deduplicated,
   no empty tags. → verify: unit tests.
2. Repository `web/src/db/cards.ts`: `createCard(input)` (validate → stamp → put → `ensureStatesForCard` →
   outbox, one transaction), `updateCard(id, patch)` (moving to another deck re-runs `ensureStatesForCard` for
   the new deck's directions), `findDuplicate(deck_id, front, excludeId?)` using `normalizeFront`,
   `listTags()` (distinct tags across non-deleted cards, for autocomplete). → verify: repository tests.
3. Route `/cards/new?deck=<id>` and `/cards/<id>/edit` → `web/src/features/cards/CardEditorPage.tsx`
   (full-screen, tab bar hidden). Fields: Deck picker, Front*, Back*, Example, Example translation, IPA,
   Tags (chips with autocomplete from `listTags()`), Notes. Top-right Save, Cancel; add mode shows
   "Save and add another" keeping deck and tags.
4. IPA helper row above the keyboard when the IPA field is focused: common symbols
   (ə ɪ ʊ ɛ æ ɑ ɔ ʌ θ ð ʃ ʒ ŋ ː ˈ ˌ) inserting at the cursor.
5. Duplicate warning under Front, debounced 300 ms: "Already in deck: *front — back*" with a link to
   `/cards/<id>`. Saving is still allowed.
6. Quick add `web/src/features/cards/QuickAddSheet.tsx`, opened by the floating "+" (add the FAB to Today and
   Decks layouts): deck selector remembering the last deck (device-local `meta` key `last_quick_add_deck`),
   single field "Word or phrase"; Enter → second field "Translation" appears (this is the Phase 1 flow for
   both online and offline); Enter/Save → create card → snackbar "Added · Edit" (Edit opens the editor),
   field cleared, focus kept in the word field.
7. Duplicate in quick add: inline warning with "Add anyway" / "Open existing" (UC-06 4a).
8. i18n keys under `cards.editor.*`, `cards.quickAdd.*`, `validation.*`.

## Tests

- Vitest: `normalizeFront('  To  Take OFF ')` → `'to take off'`; NFC: decomposed `ż` equals composed `ż`.
- Vitest: validation rejects empty front/back, front of 501 chars, notes of 2001 chars; trims whitespace.
- Vitest (fake-indexeddb): `createCard` in a `both` deck creates 2 New states and outbox entries for card and
  states; moving a card from a `forward` deck to a `both` deck adds the reverse state.
- Vitest: `findDuplicate` finds "Take off" when "take off" exists in the same deck, not in another deck, not
  when the existing card is soft-deleted.
- Playwright (WebKit): quick add two words in a row via keyboard only; duplicate warning shows "Open existing";
  editor "Save and add another" keeps deck and tags.

## Invariants to respect

- All writes via repositories in one transaction with stamp + outbox.
- No hardcoded strings; inputs at 16 px or more.
- Offline-first: no network calls.

## Rust learning notes

n/a (web-only task).

## Docs to update

- `docs/architecture.md` §4.4 (or a new short "Normalization" note): define `normalizeFront` and that it is used
  for duplicate detection in the editor, quick add and import (D10).
- `docs/architecture.md` §4.2: add `last_quick_add_deck` to the list of device-local `meta` keys.
- `docs/ui_ux.md` S-09: state that in Phase 1 the two-field flow is used even when online (AI comes in
  Phase 3), if not already clear.
- `docs/plan.md`: tick both §1.2 checkboxes above and the (added) item.

## Definition of done

- [ ] All scope items implemented
- [ ] Tests written and passing: `just test`, `just e2e` (WebKit)
- [ ] `just lint` clean
- [ ] Works offline in WebKit
- [ ] Docs updated as listed above; plan.md checkboxes ticked
- [ ] Committed: `feat(web): card editor and quick add with duplicate detection`

## If unclear

If anything in this task is ambiguous or conflicts with the docs, stop and ask before implementing.
