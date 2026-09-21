# P1-T12 — Settings and install

## Context

All Phase 1 features exist (decks, cards, import/export, study, speech), but their settings are scattered or
defaulted. This task builds the Settings screen (S-14) as an iOS-style grouped list that edits the synced
settings document and device-local preferences, and adds the iOS install hint and storage persistence handling
(`navigator.storage.persist()` + warning banner). Onboarding (P1-T13) reuses the persistence and install-hint
pieces.

## Read first

- `CLAUDE.md` (always) — "iOS / Safari gotchas"
- `docs/architecture.md` §4.2 (device-local preferences), §4.6 (UI language), §4.7 (Storage, Install hint),
  §5.5 (settings + D3 fields)
- `docs/ui_ux.md` §2 (theme), §4 (Install hint), S-14, §7 ("Storage persistence denied")
- `docs/use_cases.md` UC-21, UC-26, UC-27

## Scope

From `docs/plan.md` §1.7:

- [ ] Settings (S-14): study, audio, appearance, UI language, data sections
- [ ] Install hint on iOS Safari; `storage.persist()` handling and warning banner
- [ ] (added) Theme override System / Light / Dark (device-local `meta.theme`)
- [ ] (added) About section: app version and open-source licenses list

## Out of scope

- Account & sync (S-15, P2-T05) — do not render the "Account & sync" row until P2-T05.
- Reminders (P4-T04), FSRS Optimize (P4-T05), storage usage and "Clear cached audio" (P3-T03), server version
  and Wikimedia attributions (P2-T05, P3-T03).
- Onboarding flow (P1-T13).

## Implementation steps

1. `web/src/features/settings/SettingsPage.tsx` (grouped list, safe areas):
   - **Study:** new words per day (stepper 1–200), max reviews per day (10–1000), default directions
     (`default_directions`), answer mode (Simple / Detailed → `answer_mode`), show IPA on front
     (`show_ipa_on_front`), day starts at (hour 0–23 → `day_start_hour`), desired retention (slider 0.80–0.95,
     step 0.01, hint text).
   - **Audio:** embed `AudioSettingsSection` from P1-T11 and a row to Voices (`/settings/voices`).
   - **Appearance:** theme (System / Light / Dark), UI language (Русский / English).
   - **Data:** embed `DataSection` from P1-T06 (export JSON, CSV per deck, import backup).
   - **About:** version (from `import.meta.env` / build define), licenses page generated at build time or a
     static list of direct dependencies with licenses.
   → verify: each control persists after reload.
2. Settings writes go through `updateSettings(patch)` (stamped + outbox, P1-T01). Validation of ranges in
   `web/src/domain/settings.ts` (`validateSettingsPatch`). Changes apply to the next session (UC-21).
3. UI language: `ui_language` in synced settings; switching calls `i18n.changeLanguage` immediately and
   updates `<html lang>`; initial detection per §4.6 (settings value, else `navigator.language` starting with
   `ru`). → verify: switching re-renders without reload.
4. Theme: `meta.theme` (`system` | `light` | `dark`), applied as a class on `<html>` before first paint (inline
   script in `index.html` reading a mirrored `localStorage` value to avoid a flash; Dexie is async).
5. `web/src/lib/platform.ts`: `isIosSafari()`, `isStandalone()` (`matchMedia('(display-mode: standalone)')`
   or `navigator.standalone`).
6. Install hint `web/src/components/InstallHint.tsx`: one-time bottom sheet with 3 illustrated steps (Share →
   Add to Home Screen → Add; icons from lucide, no images needed); shown when iOS Safari and not standalone and
   `meta.install_hint_shown` is not set; also reachable from Settings → About ("Install on iPhone").
7. `web/src/lib/storage.ts`: `requestPersistence()` → `navigator.storage.persist()` (if available), store result
   in `meta.storage_persisted`; `usePersistenceStatus()`. Warning banner in Settings (and Today) when persistence
   is denied and the user is not signed in: "Your data may be removed by Safari. Sign in or export a backup."
   with an Export action. (Sign-in link appears in Phase 2.)
8. i18n keys under `settings.*`, `install.*`, `storage.*`.

## Tests

- Vitest: `validateSettingsPatch` rejects `desired_retention: 0.99`, `day_start_hour: 24`, accepts boundaries.
- Vitest (fake-indexeddb): changing `new_per_day` stamps settings and adds one outbox entry (`settings`/`user`).
- Testing Library: switching UI language to Russian changes a visible label immediately.
- Testing Library: `InstallHint` renders when `isIosSafari && !isStandalone`, not after dismissal.
- Playwright (WebKit): set theme Dark → reload → `html.dark` present before app mounts; toggle answer mode to
  Detailed → study shows 4 buttons.

## Invariants to respect

- Synced settings via the settings repository (stamp + outbox); device-local prefs in `meta` only.
- `navigator.storage.persist()` requested; iOS limitations respected (no haptics).
- No hardcoded strings (language names via `Intl.DisplayNames` except the fixed "Русский / English" labels,
  which are also i18n keys).

## Rust learning notes

n/a (web-only task).

## Docs to update

- `docs/architecture.md` §4.2: add `theme`, `install_hint_shown`, `storage_persisted` to device-local `meta` keys;
  describe the theme flash-avoidance mirror in `localStorage`.
- `docs/ui_ux.md` S-14: mark which rows arrive in later phases (Account & sync, Reminders, FSRS, storage usage).
- `docs/plan.md`: tick both §1.7 checkboxes above and the two (added) items.

## Definition of done

- [ ] All scope items implemented
- [ ] Tests written and passing: `just test`, `just e2e` (WebKit)
- [ ] `just lint` clean
- [ ] Works offline in WebKit
- [ ] Docs updated as listed above; plan.md checkboxes ticked
- [ ] Committed: `feat(web): settings screen, theme, install hint and storage persistence`

## If unclear

If anything in this task is ambiguous or conflicts with the docs, stop and ask before implementing.
