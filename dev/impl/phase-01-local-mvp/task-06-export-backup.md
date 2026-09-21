# P1-T06 — Export and backup restore

## Context

Users can create and import cards (P1-T03, P1-T05). Until the server exists (Phase 2), the only protection
against Safari evicting IndexedDB is a manual backup. This task adds a versioned full JSON backup, CSV export
per deck (in the import format), sharing via the iOS share sheet, and restoring a JSON backup either by
replacing local data or adding the backup's decks as new decks with regenerated IDs. Per decision D9, local
restore lives here; the server-side restore endpoint comes in P2-T04.

## Read first

- `CLAUDE.md` (always)
- `README.md` → "Import format" (CSV columns)
- `docs/architecture.md` §4.2, §4.3, §5.4 (entity fields), §5.5, §6.3 (payload shape — keep the backup close to
  it so P2-T04 can reuse the format)
- `docs/ui_ux.md` S-05 (context menu Export), S-06 (overflow Export deck), S-14 (Data section)
- `docs/use_cases.md` UC-24, UC-25
- `dev/impl/00-overview.md` → decision D9

## Scope

From `docs/plan.md` §1.3:

- [ ] Export: full JSON backup (versioned format) and CSV per deck; share via iOS share sheet
- [ ] Import of JSON backup: replace or add as new decks (regenerated IDs)

## Out of scope

- Server `GET /api/export` and `POST /api/import/json` (P2-T04).
- Settings screen layout (P1-T12) — add Export / Import backup entries to a minimal Data section route now; P1-T12
  integrates them into the grouped Settings list.
- Audio files (none exist in Phase 1).

## Implementation steps

1. `web/src/domain/backup/format.ts`: `BackupV1 { format: 'annette-cards-backup', version: 1, exported_at,
   app_version, decks: Deck[], cards: Card[], card_states: CardState[], review_log: ReviewLog[],
   settings: Settings }`. Include soft-deleted rows? **No** — export only non-deleted rows. Validation
   function `parseBackup(json)` → `{ ok, backup } | { ok: false, code: 'invalid_format' |
   'unsupported_version', required_version? }`. → verify: unit tests.
2. `web/src/domain/backup/regenerate.ts`: `remapIds(backup, newId)` — new ids for decks, cards, review logs;
   rewrite `deck_id`, `card_id` references; states keyed by new `card_id`. Pure. → verify: no id from the
   input appears in the output; references remain consistent.
3. `web/src/domain/export/csv.ts`: `deckToCsv(cards)` with header `front,back,example,example_translation,ipa,
   tags,notes`, tags joined by space, RFC 4180 quoting (use PapaParse `unparse`). Round-trip test with the
   P1-T05 parser.
4. `web/src/lib/share.ts`: `shareOrDownload(filename, blob, mime)` — `navigator.canShare({ files })` →
   `navigator.share`, else anchor download. Filenames: `annette-backup-YYYY-MM-DD.json`,
   `<deck-name>-YYYY-MM-DD.csv`.
5. Repository `web/src/db/backup.ts`:
   - `exportAll()` → `BackupV1` from non-deleted rows.
   - `restoreReplace(backup)`: one transaction — soft-delete all current decks/cards/states (and soft-delete
     log entries), then insert backup rows stamped with this device (`updated_at = now`) and outboxed, and
     replace settings. Soft delete (not clear) keeps the invariant and syncs correctly later.
   - `restoreAsNew(backup)`: `remapIds` then insert all rows stamped + outboxed; settings unchanged.
   Batch inserts of 500 rows per transaction for large backups; `restoreReplace` must stay atomic
   (single transaction; acceptable for expected sizes).
6. UI: `web/src/features/settings/DataSection.tsx` with "Export full backup", "Import backup" (file picker →
   validate → show counts "3 decks, 1 210 cards, 5 400 reviews" → choose **Replace local data** (Confirm sheet)
   or **Add as new decks**), and CSV export from the deck context menu (S-05) and deck overflow (S-06).
7. Errors: `unsupported_version` → "This backup needs app version X or newer" (UC-25 alternative).
8. i18n keys under `backup.*`, `export.*`.

## Tests

- Vitest: `parseBackup` rejects wrong `format`, rejects `version: 2` with `unsupported_version`, accepts a
  generated V1.
- Vitest: `remapIds` keeps 2 states per card in a `both` deck and all logs pointing to the remapped cards.
- Vitest: CSV round-trip — export then parse with the import parser gives identical fields incl. commas,
  quotes and newlines.
- Vitest (fake-indexeddb): export → `restoreAsNew` doubles the deck count, ids differ, outbox has entries;
  `restoreReplace` leaves only backup decks visible, old rows soft-deleted.
- Playwright (WebKit): export backup (download) → wipe via app → import backup → Replace → deck and card counts
  match.

## Invariants to respect

- IDs UUIDv7 for regenerated entities; every write stamped and outboxed; soft deletes only.
- `review_log` rows are inserted (append), never mutated, except soft delete on replace.
- No hardcoded strings; works offline.

## Rust learning notes

n/a (web-only task).

## Docs to update

- `docs/architecture.md`: add a short "Backup format" subsection (fields, version, only non-deleted rows) so
  P2-T04 (`GET /api/export`, `POST /api/import/json`) uses the same format.
- `docs/use_cases.md` UC-25: note that local restore is available in Phase 1 (D9).
- `docs/plan.md`: tick both §1.3 checkboxes above.

## Definition of done

- [ ] All scope items implemented
- [ ] Tests written and passing: `just test`, `just e2e` (WebKit)
- [ ] `just lint` clean
- [ ] Works offline in WebKit
- [ ] Docs updated as listed above; plan.md checkboxes ticked
- [ ] Committed: `feat(web): JSON backup export/restore and CSV deck export`

## If unclear

If anything in this task is ambiguous or conflicts with the docs, stop and ask before implementing.
