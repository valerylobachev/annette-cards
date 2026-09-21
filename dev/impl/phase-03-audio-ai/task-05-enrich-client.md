# P3-T05 — Enrichment (client)

## Context

P3-T04 added `POST /api/enrich` (typed in the orval client after `just gen-api`) returning suggested `back`,
`example`, `example_translation`, `ipa`, `notes`, with error codes for disabled feature, quota, timeout and
provider errors, and `features.enrich` in `/api/meta`. P3-T03 added `useServerFeatures()`. The card editor
(S-08) and Quick add (S-09) from Phase 1 are fully manual. This task adds "Fill with AI" with ghost suggestions
and per-field accept to the editor, and one-tap save with suggestions to Quick add, so that adding a word with
AI takes two taps.

## Read first

- `CLAUDE.md` (always; offline-first, no hardcoded strings)
- `docs/ui_ux.md` S-08 ("Fill with AI", ghost values, accept all / per field, no silent overwrite), S-09 (quick
  add flow online vs offline), §4 Offline hint, §7 (AI quota exceeded)
- `docs/use_cases.md` UC-06 (alternative 3a), UC-09 (main flow and alternatives 3a, 3b, 4a)
- `docs/architecture.md` §4.6 (error codes → `errors.<code>`), §8
- `docs/tech_stack.md` → TanStack Query, orval
- Code: `web/src/features/cards/` editor and quick add sheet (P1-T03), `useServerFeatures()` (P3-T03)

## Scope

From `docs/plan.md` §3.3:

- [ ] "Fill with AI" in the card editor with ghost suggestions and per-field accept
- [ ] Quick add with suggestions (one-tap save)

## Out of scope

- Server prompt or quota changes → P3-T04 (if quality is poor, note it and ask).
- Persisting suggestions anywhere except when the user saves the card through the normal repository path.
- Enrichment during CSV import.

## Implementation steps

1. **Hook** `web/src/features/enrich/useEnrich.ts`: TanStack Query mutation around the generated `enrich` call
   with `{front, target_lang, native_lang}` from the selected deck; no automatic retries (server already
   retries); abort on unmount; returns `{suggest, data, error, isPending}` with `error` normalized to a code.
   `canEnrich = features.enrich && signedIn && navigator.onLine` (react to `online`/`offline` events).
   → verify: hook test with mocked client (success, `enrich_quota_exceeded`, network error).
2. **Suggestion model** (pure, in `web/src/domain/enrich.ts`): `mergeSuggestions(current, suggestion)` returns
   per-field `{value, suggestion, status: 'empty-fill' | 'conflict' | 'same'}`; `acceptAll` fills empty fields
   directly and marks conflicting (already-filled, different) fields as needing confirmation.
   → verify: unit tests below.
3. **Editor (S-08).** Button **Fill with AI** next to Front: visible only when `features.enrich` and signed in;
   enabled when Front is non-empty and online; offline → disabled with the Offline hint. While pending: spinner
   on the button, form stays editable. Suggestions render as ghost values (muted text inside or under each
   field) with a per-field ✓ accept and a top-level **Accept all**. Accepting into a filled field asks for
   confirmation (confirm sheet) — never overwrite silently (UC-09 4a). Editing a field dismisses its ghost.
   Errors inline under Front: `enrich_quota_exceeded` → "Daily AI limit reached, try tomorrow";
   `provider_timeout` / `provider_error` / network → "Could not get suggestions, fill in manually".
   → verify: component tests.
4. **Quick add (S-09).** Enter on "Word or phrase": if `canEnrich` → call enrich and show a compact
   suggestion card (translation + example, IPA small) with a primary **Save** button (one tap saves the card with
   `front` + accepted `back`, `example`, `example_translation`, `ipa`, `notes`) and "Edit" (opens S-08 with the
   suggestions prefilled as ghosts). Otherwise (offline, disabled, signed out, or on any error) → the existing
   second field "Translation" appears; an error shows a one-line hint but never blocks manual entry. Duplicate
   check (existing `normalizeFront`) still runs before save. After save: snackbar "Added · Edit", field cleared,
   keyboard stays open (keep focus). → verify: component tests; manual on iPhone.
5. **i18n.** Keys under `enrich.*` and `errors.enrich_quota_exceeded`, `errors.enrich_disabled`,
   `errors.provider_timeout`, `errors.provider_error` in both `en.json` and `ru.json`. → verify: i18n key
   parity check (existing test or `just lint`).
6. **E2E** (Playwright, WebKit, `/api/enrich` and `/api/meta` mocked with `page.route`): quick add online →
   type "żółw", Enter, tap Save → card appears in deck with suggested translation (two taps after typing:
   Enter/Save); offline → translation field appears. → verify: `just e2e`.

## Tests

- `mergeSuggestions`: empty field filled; identical value → `same`; different filled value → `conflict`;
  `acceptAll` leaves conflicts untouched until confirmed.
- Editor: button hidden when `features.enrich` false; disabled when Front empty or offline; accept one field;
  accept all with a conflict shows confirm sheet; quota error text localized (RU and EN).
- Quick add: online+enabled → suggestion card and one-tap save writes a card via the repository (with
  outbox entry and card states for active directions); error → falls back to translation field; offline →
  never calls the API.
- E2E as in step 6.

## Invariants to respect

- Offline-first: the card is written through `web/src/db/` repositories (outbox, `updated_at`, `updated_by`);
  the enrich API is only a suggestion source.
- Nothing is saved without an explicit user action.
- No hardcoded UI strings; server errors are codes mapped to `errors.<code>`.
- Inputs keep font-size ≥ 16 px (no iOS zoom); thumb-zone placement for Save.

## Docs to update

- `docs/ui_ux.md` S-08/S-09: exact suggestion layout and error texts if they differ from the doc.
- `docs/use_cases.md` UC-06/UC-09: only if the flow changed (e.g. the "Edit" path from quick add).
- `docs/plan.md`: tick the two checkboxes above.

## Definition of done

- [ ] All scope items implemented
- [ ] Tests written and passing: `just test` and `just e2e` (WebKit)
- [ ] `just lint` clean
- [ ] Works offline in WebKit (manual flow unchanged; AI button disabled with hint)
- [ ] Docs updated as listed above; plan.md checkboxes ticked
- [ ] Committed: `feat(web): AI suggestions in card editor and quick add`

## If unclear

If anything in this task is ambiguous or conflicts with the docs, stop and ask before implementing.
