# P1-T04 — Deck detail and card view

## Context

Decks (P1-T02) and cards (P1-T03) can be created. There is no way to browse a deck's cards or inspect one
card. This task builds Deck detail (S-06) with a virtualized, searchable, filterable list and multi-select, and
Card view (S-07) with fields, per-direction progress, reset progress and delete. The study screen arrives in
P1-T09, but the "Study deck" and "Practice difficult" buttons are wired now to `/study?deck=<id>` and
`/study?deck=<id>&practice=1` (the route placeholder exists since Phase 0).

## Read first

- `CLAUDE.md` (always)
- `docs/architecture.md` §4.2 (indexes on `cards`, `card_states`), §5.4 `card_states`, `review_log`
- `docs/ui_ux.md` S-06, S-07, §6 (long-press, swipe row, pull-down search), §7
- `docs/use_cases.md` UC-05, UC-07, UC-16 (entry point only)

## Scope

From `docs/plan.md` §1.2:

- [ ] Deck detail (S-06): list (virtualized), search, sort, state filters, tag chips
- [ ] Card view (S-07): fields, progress per direction, reset progress, delete
- [ ] (added) Multi-select mode in deck detail (long-press): move to deck, add/remove tag, reset progress,
      delete

## Out of scope

- Pronunciation section of the card view (P3-T03). Leave no placeholder buttons for server audio.
- Speaker buttons in rows and card view (P1-T11).
- Study screen and practice logic (P1-T08, P1-T09) — only navigation here.
- Deck export (P1-T06) and import into deck (P1-T05): menu items link to the respective routes.

## Implementation steps

1. Domain `web/src/domain/cardFilters.ts`: pure functions for search (front, back, example, tags; using
   `normalizeFront`-style case/NFC folding), sort (`added_desc`, `due_asc`, `alpha`, `difficulty_desc`) and
   state filters (`new`, `learning` = Learning|Relearning, `review`, `difficult` = lapses ≥ 3 in any
   direction). → verify: unit tests.
2. Repository `web/src/db/cards.ts`: `listDeckCardsWithStates(deck_id)` returning card + its states (live
   query), `moveCards(ids, deck_id)`, `addTag(ids, tag)`, `removeTag(ids, tag)`, `deleteCards(ids)`,
   `resetProgress(card_ids)` (states back to New via `newCardState`, **review_log kept**), each one
   transaction with stamp + outbox per row. → verify: repository tests.
3. Route `/decks/<id>` → `web/src/features/decks/DeckDetailPage.tsx`: header (name, language pair, overflow
   menu: Deck settings, Import into deck, Export deck, Archive, Delete); stats strip (New · Learning · Review ·
   Difficult) whose chips toggle filters; buttons **Study deck** → `/study?deck=<id>` and **Practice difficult**
   → `/study?deck=<id>&practice=1`; search (pull-down reveal); sort select; tag chips (horizontal scroll).
4. Virtualized list (choose `@tanstack/react-virtual` only if needed; record it in `tech_stack.md`) with rows:
   front (bold), back (secondary), status dot colored by state, due date (relative, `lib/intl.ts`). Must stay
   smooth with 5 000+ cards.
5. Multi-select: long-press a row enters selection mode; bottom action bar: Move to deck (deck picker), Add tag,
   Remove tag, Reset progress (confirm), Delete (confirm + Undo snackbar).
6. Empty state: "This deck is empty" + "Add word" (`/cards/new?deck=<id>`) and "Import" (`/import?deck=<id>`).
7. Route `/cards/<id>` → `web/src/features/cards/CardViewPage.tsx`: large front, IPA, back, example + its
   translation, tags, notes; **Progress** per active direction: state name, next due (relative), stability,
   difficulty, reps, lapses, mini history of the last 10 `review_log` entries (non-deleted) as colored dots by
   rating. Actions: Edit (`/cards/<id>/edit`), Reset progress (confirm), Delete (confirm → soft delete → back to
   deck → snackbar Undo).
8. i18n keys under `deck.*`, `card.view.*`, `card.states.*`.

## Tests

- Vitest: filters — `difficult` includes a card with lapses 3 on reverse only; search finds a tag and an
  example substring; `due_asc` puts New cards last.
- Vitest (fake-indexeddb): `resetProgress` sets states to New, keeps `review_log` rows, adds outbox entries for
  states only; `moveCards` into a `both` deck creates missing reverse states.
- Testing Library: card view shows two progress blocks for a `both` deck and one for `forward`.
- Playwright (WebKit): seed 5 000 cards, open the deck, scroll to the bottom without errors; multi-select 3
  cards → delete → Undo restores them; "Study deck" navigates to `/study?deck=<id>`.

## Invariants to respect

- Reads via `useLiveQuery`; writes via repositories (stamp + outbox, one transaction).
- Soft delete only; `review_log` never modified by reset progress.
- No hardcoded strings; touch targets ≥ 44 px.

## Rust learning notes

n/a (web-only task).

## Docs to update

- `docs/tech_stack.md`: add the virtualization library if one is introduced, with rationale.
- `docs/ui_ux.md` S-06: document the exact filter definitions if they differ (e.g. "Learning" includes
  Relearning).
- `docs/plan.md`: tick both §1.2 checkboxes above and the (added) item.

## Definition of done

- [ ] All scope items implemented
- [ ] Tests written and passing: `just test`, `just e2e` (WebKit)
- [ ] `just lint` clean
- [ ] Works offline in WebKit
- [ ] Docs updated as listed above; plan.md checkboxes ticked
- [ ] Committed: `feat(web): deck detail with filters and multi-select, card view with progress`

## If unclear

If anything in this task is ambiguous or conflicts with the docs, stop and ask before implementing.
