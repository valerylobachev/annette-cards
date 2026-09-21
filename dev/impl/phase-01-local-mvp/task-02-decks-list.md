# P1-T02 — Decks list and card states

## Context

P1-T01 delivered domain types, the Dexie schema, repositories with outbox and the settings repository. The app
still shows placeholder screens. This task makes the Decks tab real (S-05): create, rename, change settings,
archive, soft delete with Undo. It also owns the rule "each card has one state per active direction", which
every later card write (editor, quick add, import, restore) reuses. Shared UI components (Snackbar, Confirm
sheet, Empty state) and `Intl` helpers are introduced here because this is the first screen that needs them.

## Read first

- `CLAUDE.md` (always)
- `docs/architecture.md` §4.3 (write path), §4.4 "Directions", §6.1 (soft delete propagation)
- `docs/ui_ux.md` §4 (global components), S-05, §6 (gestures: swipe row, long-press, pull-down), §7 (deleting a
  deck), §9 (localization)
- `docs/use_cases.md` UC-05
- `docs/tech_stack.md` → shadcn/ui, lucide-react, i18next, `motion` (optional for row swipe)

## Scope

From `docs/plan.md` §1.2:

- [ ] Decks list (S-05): create sheet, rename, archive, soft delete with Undo snackbar
- [ ] Card state creation per active direction; handling of direction changes on deck settings
- [ ] (added) Shared components: Snackbar (4 s default, used with Undo), Confirm sheet (iOS-style bottom sheet),
      Empty state (text + one primary action)
- [ ] (added) `Intl` helpers: language names via `Intl.DisplayNames`, relative dates via
      `Intl.RelativeTimeFormat`, both in the UI locale
- [ ] (added) Deleting a deck soft-deletes its cards and their states in the same transaction (§6.1)

## Out of scope

- Deck detail screen and card list (P1-T04); card editor and quick add (P1-T03).
- Deck CSV export from the context menu — show the menu item, wire it in P1-T06.
- Import button in empty state — link to the `/import` route; the wizard is P1-T05.
- Due badge counts from the scheduler: use a simple count of `card_states` with `due <= now` and state ≠ New
  for now; P1-T07 provides the real study-day-aware helper.

## Implementation steps

1. Components in `web/src/components/`: `Snackbar` (provider + `useSnackbar().show({ message, action,
   duration })`), `ConfirmSheet`, `EmptyState`. Snackbar sits above the tab bar and respects safe areas.
   → verify: component tests render and fire the action callback.
2. `web/src/lib/intl.ts`: `languageName(code, uiLocale)`, `relativeTime(ms, uiLocale)`, `formatNumber`.
   → verify: unit tests for `pl` in `ru` ("польский") and `en` ("Polish").
3. Domain `web/src/domain/directions.ts`: `activeDirections(directions: 'forward'|'reverse'|'both')` and
   `newCardState(card_id, direction, now)` producing a New state (state 0, `due = now`, zeros per ts-fsrs empty
   card). Keep the ts-fsrs-compatible shape; P1-T07 will reuse it. → verify: unit tests.
4. Repository `web/src/db/cardStates.ts`: `ensureStatesForCard(card, deck)` creates missing states for active
   directions (never resets existing ones). `applyDeckDirections(deck)`: when directions change, create missing
   New states for newly active directions for all cards in the deck; states of a disabled direction are **kept**
   (hidden from queues by P1-T07, not deleted). → verify: tests below.
5. Repository `web/src/db/decks.ts` additions: `archiveDeck`, `unarchiveDeck`, `deleteDeck` (soft-deletes deck,
   its cards and their states, one transaction, outbox for each), `undeleteDeck` (reverses exactly those rows
   by clearing `deleted_at`; stamped as a new change).
6. Screen `web/src/features/decks/DecksListPage.tsx` (route from P0): title, search field revealed on pull-down,
   rows with name, language pair ("EN-GB → RU"), card count, progress bar (new / learning / mature), due badge;
   "Archived" collapsed section; empty state "No decks yet" with "Create deck" and "Import file".
7. `CreateDeckSheet` / `DeckSettingsSheet` (shared form): name, target language + variant chips (en-GB/en-US,
   pl-PL pinned first), native language (default `ru`), directions (Forward/Reverse/Both, default from
   `settings.default_directions`), optional new-per-day override. Validation: name required, ≤ 100 chars.
8. Row interactions: swipe left → Archive / Delete; long-press → context menu (Rename, Settings, Export,
   Delete). Every action also reachable via buttons (accessibility).
9. Delete flow: Confirm sheet with card count ("Delete deck and 312 cards?") → soft delete → snackbar "Deck
   deleted · Undo" for **10 s** (§7).
10. i18n keys under `decks.*`, `common.*`, `snackbar.*` in `en.json` and `ru.json` with Russian plural forms.

## Tests

- Vitest: deck with `directions = 'both'` + new card → 2 states; switch to `forward` → reverse state kept,
  no new rows; switch back to `both` → no duplicates.
- Vitest: `deleteDeck` sets `deleted_at` on deck, cards, states; outbox contains all of them; `undeleteDeck`
  restores and bumps `updated_at`.
- Testing Library: create deck via sheet appears in the list; archive moves it to the Archived section.
- Playwright (WebKit): create deck → rename → delete → Undo within 10 s restores it; RU UI shows plurals.

## Invariants to respect

- Offline-first: screens read via `useLiveQuery`, write via repositories only.
- Every mutation stamped and outboxed in one transaction; soft deletes only.
- No hardcoded UI strings.

## Rust learning notes

n/a (web-only task).

## Docs to update

- `docs/ui_ux.md` S-05 / §4: only if the implemented behavior deviates (e.g. snackbar durations).
- `docs/architecture.md` §4.4 "Directions": state explicitly that disabled-direction states are kept.
- `docs/plan.md`: tick both §1.2 checkboxes above and the three (added) items.

## Definition of done

- [ ] All scope items implemented
- [ ] Tests written and passing: `just test`, `just e2e` (WebKit)
- [ ] `just lint` clean
- [ ] Works offline in WebKit
- [ ] Docs updated as listed above; plan.md checkboxes ticked
- [ ] Committed: `feat(web): decks list with archive, soft delete and per-direction card states`

## If unclear

If anything in this task is ambiguous or conflicts with the docs, stop and ask before implementing.
