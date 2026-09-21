# Development Plan

The plan is split into phases that each end with a usable product. Phase 1 delivers a fully local app on the
iPhone; the Rust backend starts in Phase 2, once the data model and API needs are proven by real use.

Work rules (see also `CLAUDE.md`): take the first unchecked task of the current phase, implement it with tests,
run `just lint` and `just test`, tick the checkbox, update docs if behavior changed.

Step-by-step task prompts for every subsection live in [`dev/impl/`](../dev/impl/00-overview.md). Items marked
`(added)` came from the architecture coverage analysis in that overview.

## Overview

| Phase | Goal | Main result | Use cases |
| --- | --- | --- | --- |
| 0. Bootstrap | Repository, tooling, CI, skeletons | `just dev` runs web + server; CI green | — |
| 1. Local MVP | Study own words on iPhone offline | Installed PWA with decks, import, swipe study, FSRS, voices | UC-01, 05–08, 10–12, 16–18, 21, 22, 24, 26, 27 |
| 2. Backend & sync | Accounts and multi-device sync | Deployed server, invites, sync, backups | UC-02–04, 20, 25, 28, 29 |
| 3. Audio & AI | Pronunciation control and fast word entry | Generated/recorded audio, AI enrichment | UC-09, 13 |
| 4. Polish | Full Duocards replacement | More modes, statistics, reminders, FSRS optimization | UC-14, 15, 19, 23, 30 |

---

## Phase 0 — Bootstrap

**Goal:** a working monorepo skeleton with all tooling, so that later tasks only add features.

### Repository and tooling
Task: [P0-T01](../dev/impl/phase-00-bootstrap/task-01-repo-tooling.md)

- [x] Create repo structure (`web/`, `server/`, `deploy/`, `docs/`), `.gitignore`, `.editorconfig`
- [x] `justfile` with recipes: `dev`, `dev-web`, `dev-server`, `test`, `e2e`, `lint`, `fmt`, `gen-api`,
      `db-new`, `db-migrate`, `sqlx-prepare`, `build`, `release`, `deploy`
- [x] (added) `just dev-https` recipe; remove `Cargo.lock` from `.gitignore` (binary crate, pinned versions)
- [x] GitHub Actions: lint + test for web and server on push; build release binary on tag

### Web skeleton
Task: [P0-T02](../dev/impl/phase-00-bootstrap/task-02-web-skeleton.md)

- [x] Vite + React 19 + TypeScript (strict) with pnpm
- [x] Tailwind 4, shadcn/ui init, lucide-react, dark mode via system preference
- [x] TanStack Router with routes for all screens (placeholder pages) and bottom tab bar layout
- [x] i18next with `en.json`/`ru.json`, language detection, one translated string per screen
- [x] Biome config; Vitest + Testing Library; Playwright with WebKit and Chromium projects
- [x] `vite-plugin-pwa`: manifest, icons (incl. maskable, apple-touch-icon), iOS meta tags, update prompt banner
- [x] Vite proxy `/api` → `127.0.0.1:8080`

### Server skeleton (Rust learning start)
Task: [P0-T03](../dev/impl/phase-00-bootstrap/task-03-server-skeleton.md)

- [x] Cargo project (edition 2024), crates from `tech_stack.md`
- [x] `clap` CLI with `serve` and `openapi` subcommands
- [x] `figment` config, `tracing` setup, `AppState`, `AppError` with `IntoResponse`
- [x] SQLite pool with pragmas (WAL, foreign keys, busy timeout), migrations on startup, empty initial migration
- [x] `GET /api/health` and `GET /api/meta`; router test with `oneshot`
- [x] `utoipa` OpenAPI; `just gen-api` produces `web/openapi.json` and the orval client
- [x] `rust-embed` serving of `web/dist` with SPA fallback and cache headers
- [x] (added) `server/.env.example`; tower-http trace, compression and 30 s timeout layers; `GET /api/openapi.json`

Acceptance task: [P0-T04](../dev/impl/phase-00-bootstrap/task-04-phase-acceptance.md)

**Acceptance:** `just dev` shows the app shell with tabs in RU/EN; `/api/health` returns OK; CI passes;
`just build` produces one binary that serves the PWA.

---

## Phase 1 — Local MVP (no backend required)

**Goal:** the owner studies English words on the iPhone every day, fully offline.

### 1.1 Data layer
Task: [P1-T01](../dev/impl/phase-01-local-mvp/task-01-data-layer.md)

- [ ] Domain types (`Deck`, `Card`, `CardState`, `ReviewLog`, `Settings`) matching `architecture.md` §5.4
- [ ] Dexie schema v1 (§4.2), device id generation, UUIDv7 helper
- [ ] Repositories with transactional writes (`updated_at`, `updated_by`, outbox entry) — tests with
      `fake-indexeddb`
- [ ] Settings repository with defaults (§5.5) and device-local preferences in `meta`
- [ ] (added) Settings fields `default_directions` and `show_ipa_on_front` (documented in §5.5)

### 1.2 Decks and cards
Tasks: [P1-T02](../dev/impl/phase-01-local-mvp/task-02-decks-list.md) · [P1-T03](../dev/impl/phase-01-local-mvp/task-03-card-editor-quick-add.md) · [P1-T04](../dev/impl/phase-01-local-mvp/task-04-deck-detail-card-view.md)

- [ ] Decks list (S-05): create sheet, rename, archive, soft delete with Undo snackbar
- [ ] Deck detail (S-06): list (virtualized), search, sort, state filters, tag chips
- [ ] Card editor (S-08): fields, validation, duplicate warning, tag autocomplete, IPA helper row
- [ ] Quick add sheet (S-09) with offline two-field flow
- [ ] Card view (S-07): fields, progress per direction, reset progress, delete
- [ ] Card state creation per active direction; handling of direction changes on deck settings
- [ ] (added) Shared Snackbar, Confirm sheet and Empty state components; `Intl` helpers (language names, relative dates); deck soft delete cascades to its cards
- [ ] (added) `normalizeFront` domain function for duplicate detection (card editor, import)
- [ ] (added) Deck detail multi-select: move to deck, add/remove tag, reset progress, delete

### 1.3 Import / export
Tasks: [P1-T05](../dev/impl/phase-01-local-mvp/task-05-csv-import.md) · [P1-T06](../dev/impl/phase-01-local-mvp/task-06-export-backup.md)

- [ ] CSV/TSV parser in a Web Worker (PapaParse): delimiter/header detection, UTF-8 check
- [ ] Import wizard (S-10): mapping with auto-detection of header synonyms (EN/RU), validation, duplicates
      strategy, batch insert, result screen
- [ ] Export: full JSON backup (versioned format) and CSV per deck; share via iOS share sheet
- [ ] Import of JSON backup: replace or add as new decks (regenerated IDs)

### 1.4 Study engine (domain, pure TS)
Tasks: [P1-T07](../dev/impl/phase-01-local-mvp/task-07-scheduler-session-builder.md) · [P1-T08](../dev/impl/phase-01-local-mvp/task-08-answers-undo-practice.md)

- [ ] `ts-fsrs` wrapper with settings (retention, short-term steps, fuzz)
- [ ] Study-day calculation with `day_start_hour`; daily counters (new introduced, reviews done)
- [ ] Session builder: due first, new interleaved 1:4, limits, sibling burying, learning re-insertion
- [ ] Answer transaction: next state + review log (with `state_before`) + outbox, atomically
- [ ] Undo last answer
- [ ] Practice mode for difficult words (no FSRS change for non-due cards)
- [ ] Unit tests covering queue order, limits, day boundary, burying, undo
- [ ] (added) `practice` flag on `review_log` for practice answers (UC-16)

### 1.5 Study UI
Tasks: [P1-T09](../dev/impl/phase-01-local-mvp/task-09-study-session-swipe.md) · [P1-T10](../dev/impl/phase-01-local-mvp/task-10-today-summary.md)

- [ ] Today (S-04): due/new counts, estimate, Start, deck-due list, streak
- [ ] Study session shell (S-11): start gate, progress, counters, close confirm, undo, resume within 30 min
- [ ] Swipe cards with `motion`: flip, drag with rotation and overlays, thresholds, buttons alternative,
      simple and detailed answer modes, stack preview
- [ ] Session summary (S-12) with "Repeat these now"
- [ ] Reduced-motion variants and VoiceOver labels
- [ ] (added) Deep link `/study?deck=&mode=&practice=1`; long-text auto-shrink on study cards
- [ ] (added) Today: "Learn extra new words" (+10 today) and "Practice difficult words"; minimal current-streak function (full logic in 4.2); no mode selector until 4.1

### 1.6 Speech
Task: [P1-T11](../dev/impl/phase-01-local-mvp/task-11-speech.md)

- [ ] Speech service: voice loading (`voiceschanged`), best-voice selection per locale, explicit `lang`, rate
- [ ] Autoplay settings (off / front / front+answer), tap-to-speak word and example
- [ ] Voices screen (S-16) with samples and iOS voice download guide
- [ ] Missing-voice warning on study start
- [ ] (added) Speaker buttons in deck rows, card view, card editor and the study card

### 1.7 App shell and settings
Tasks: [P1-T12](../dev/impl/phase-01-local-mvp/task-12-settings-install.md) · [P1-T13](../dev/impl/phase-01-local-mvp/task-13-onboarding-offline.md)

- [ ] Onboarding (S-01) including language, daily goal, first deck, persistence request
- [ ] Settings (S-14): study, audio, appearance, UI language, data sections
- [ ] Install hint on iOS Safari; `storage.persist()` handling and warning banner
- [ ] Offline verification: app shell precache, airplane-mode E2E test (Playwright offline context)
- [ ] (added) Settings → About (app version, licenses); onboarding hides "I have an account" until Phase 2

Acceptance task: [P1-T14](../dev/impl/phase-01-local-mvp/task-14-phase-acceptance.md)

**Acceptance:**
- On a real iPhone (installed PWA, airplane mode): import a 300-word CSV, study a session with swipes and audio,
  close the app, reopen — progress is intact.
- Next day the due queue contains the expected cards.
- UI fully usable in Russian and English.
- E2E tests (WebKit) cover onboarding, import, study session, undo.

---

## Phase 2 — Backend and sync

**Goal:** accounts for the owner and a few invited users; data syncs between iPhone and laptop; server runs on
the VPS with backups.

### 2.1 Auth (server)
Tasks: [P2-T01](../dev/impl/phase-02-backend-sync/task-01-auth-core.md) · [P2-T02](../dev/impl/phase-02-backend-sync/task-02-invites-security.md)

- [ ] Migrations: `users`, `invites`, `sessions`
- [ ] CLI `create-user` (with `--admin`) and `invite` subcommands
- [ ] Argon2id hashing; login, logout, logout-others, me, change password
- [ ] Session cookie, `CurrentUser` extractor, sliding expiry, hourly cleanup task
- [ ] Register with invite (validation, single use, expiry)
- [ ] Admin invite endpoints (list/create/revoke), admin-only guard
- [ ] Origin check middleware, login rate limiting (`tower_governor`), security headers
- [ ] Integration tests for all auth flows
- [ ] (added) JSON logs in production; request id and hashed user id in request spans (architecture §13)

### 2.2 Sync (server)
Tasks: [P2-T03](../dev/impl/phase-02-backend-sync/task-03-sync-push.md) · [P2-T04](../dev/impl/phase-02-backend-sync/task-04-sync-pull-export.md)

- [ ] Migrations: `sync_seq`, `decks`, `cards`, `card_states`, `review_log`, `user_settings` with indexes
- [ ] `server_seq` allocation inside transactions
- [ ] Push: validation, ownership checks, LWW merge per entity, dependency order, applied/skipped/rejected
- [ ] Pull: cursor paging across entities ordered by `server_seq`
- [ ] Export endpoint (JSON) and restore into an empty account
- [ ] Property-style tests: two simulated devices with interleaved edits converge to the same state
- [ ] (added) Request body limit 2 MB and field length limits on push (architecture §9); `practice` column in `review_log`
- [ ] (added) `GET /api/sync/summary` returning account counts for the first sign-in choice (S-03)

### 2.3 Sync (client)
Tasks: [P2-T05](../dev/impl/phase-02-backend-sync/task-05-auth-screens.md) · [P2-T06](../dev/impl/phase-02-backend-sync/task-06-sync-engine.md) · [P2-T07](../dev/impl/phase-02-backend-sync/task-07-first-signin-signout.md)

- [ ] Auth screens (S-02) and Account & sync (S-15) incl. admin invites section
- [ ] Sync engine: triggers (start, visible, online, debounced change, manual), push batches, pull loop, cursor
- [ ] LWW merge into Dexie; outbox clearing; error log; clock skew warning
- [ ] First sign-in flow with local data (S-03): merge / use account / cancel
- [ ] Sign-out with unsynced-changes warning and local wipe
- [ ] Sync indicator component
- [ ] E2E: two browser contexts sync edits and study progress
- [ ] (added) Shared Offline hint component; server version in Settings → About; pull-down on Today triggers sync
- [ ] (added) "I have an account" button on onboarding

### 2.4 Deployment
Tasks: [P2-T08](../dev/impl/phase-02-backend-sync/task-08-deploy-artifacts.md) · [P2-T09](../dev/impl/phase-02-backend-sync/task-09-vps-provisioning.md)

- [ ] `deploy/`: Caddyfile, systemd unit with hardening, env template, `litestream.yml`, `deploy/README.md`
- [ ] `just release` (cargo-zigbuild, musl) and `just deploy` (upload, symlink switch, restart)
- [ ] Provision VPS: user, directories, Caddy, Litestream to S3-compatible bucket
- [ ] Restore drill: restore the DB from the bucket into a temp file and verify
- [ ] Uptime check on `/api/health`

Acceptance task: [P2-T10](../dev/impl/phase-02-backend-sync/task-10-phase-acceptance.md)

**Acceptance:** owner and one invited user each use the app on two devices; offline edits on both converge after
reconnect; a VPS restart and a restore drill lose no data.

---

## Phase 3 — Audio and AI

**Goal:** correct pronunciation for any word and near-instant word entry.

### 3.1 Server audio
Tasks: [P3-T01](../dev/impl/phase-03-audio-ai/task-01-tts-audio-server.md) · [P3-T02](../dev/impl/phase-03-audio-ai/task-02-commons-recordings.md)

- [ ] `audio_assets` migration; `GET /api/audio/{id}` with immutable caching headers
- [ ] `TtsProvider` trait and Azure implementation (SSML, voice per language, IPA `<phoneme>`)
- [ ] Wikimedia Commons lookup for EN and PL pronunciations with attribution
- [ ] Verify OGG playback on iOS Safari; if unsupported, add transcoding to MP3/AAC (decision recorded in
      `architecture.md`)
- [ ] (added) `X-Audio-Source` / `X-Audio-Attribution` headers on `GET /api/audio/{id}`; server edits use `updated_by = 'server'`
- [ ] Card update on audio attach/remove (bumps `server_seq`), rate limiting, feature flags in `/api/meta`

### 3.2 Client audio
Task: [P3-T03](../dev/impl/phase-03-audio-ai/task-03-client-audio.md)

- [ ] Card view pronunciation section: generate, find recording, remove, attribution display
- [ ] Playback chain: cached MP3 → download+cache → system voice fallback
- [ ] Workbox runtime cache for `/api/audio/*`; optional prefetch for active decks after sync
- [ ] "Clear cached audio" and storage usage in Settings
- [ ] (added) Wikimedia attributions list in Settings → About

### 3.3 AI enrichment
Tasks: [P3-T04](../dev/impl/phase-03-audio-ai/task-04-enrich-server.md) · [P3-T05](../dev/impl/phase-03-audio-ai/task-05-enrich-client.md)

- [ ] `Enricher` trait and Anthropic implementation; strict JSON prompt; validation and one retry
- [ ] Daily quota (`enrich_usage`), error codes
- [ ] "Fill with AI" in the card editor with ghost suggestions and per-field accept
- [ ] Quick add with suggestions (one-tap save)
- [ ] Prompt tuned for EN→RU and PL→RU (Polish: gender, aspect pairs in notes)

Acceptance task: [P3-T06](../dev/impl/phase-03-audio-ai/task-06-phase-acceptance.md)

**Acceptance:** a homograph and a Polish word with diacritics get correct audio on the iPhone, offline after the
first play; adding a word with AI takes two taps.

---

## Phase 4 — Polish

**Goal:** everything needed to fully replace Duocards.

### 4.1 Study modes
Tasks: [P4-T01](../dev/impl/phase-04-polish/task-01-typing-mode.md) · [P4-T02](../dev/impl/phase-04-polish/task-02-choice-listening-modes.md)

- [ ] Multiple choice with smart distractors
- [ ] Listening mode (auto-play, slower replay, choose/type)
- [ ] Typing mode: normalization, Damerau–Levenshtein tolerance, diacritics-insensitive near miss, diff highlight
- [ ] Mode selector on Today; mode stored in review log
- [ ] (added) `listening_answer` setting (choose / type)

### 4.2 Statistics
Task: [P4-T03](../dev/impl/phase-04-polish/task-03-statistics.md)

- [ ] Statistics screen (S-13): reviews per day, forecast, states, retention, time, heatmap, KPIs
- [ ] Streak logic based on study days

### 4.3 Reminders
Task: [P4-T04](../dev/impl/phase-04-polish/task-04-reminders.md)

- [ ] VAPID config, `push_subscriptions`, subscribe/unsubscribe endpoints
- [ ] Reminder task (per-user time and timezone, only when due cards exist and not studied today)
- [ ] Client: permission flow (installed PWA only), notification click opens Today

### 4.4 FSRS optimization
Task: [P4-T05](../dev/impl/phase-04-polish/task-05-fsrs-optimization.md)

- [ ] Server endpoint using `fsrs` crate on the user's review log; minimum review count check
- [ ] Client: Optimize button, comparison display, apply weights to settings
- [ ] (added) `fsrs_optimized_at` setting (last optimized date in S-14)

### 4.5 Quality
Tasks: [P4-T06](../dev/impl/phase-04-polish/task-06-accessibility-performance.md) · [P4-T07](../dev/impl/phase-04-polish/task-07-purge-docs.md)

- [ ] Accessibility pass (VoiceOver, dynamic type, contrast)
- [ ] Performance pass: 10 000 cards deck — list scroll, session build < 100 ms, import < 10 s
- [ ] Purge job for old soft-deleted rows and orphaned audio
- [ ] Documentation refresh (README screenshots, user guide in RU/EN)
- [ ] (added) `purge` CLI subcommand reusing the purge job
- [ ] (added) Measure DB size with audio and record the 1 GB decision (architecture §15)

Acceptance task: [P4-T08](../dev/impl/phase-04-polish/task-08-phase-acceptance.md)

**Acceptance:** 30 consecutive days of daily use by the owner with EN and PL decks without needing any other app.

---

## Backlog (not planned yet)

- Shared decks between users (read-only subscription or copy)
- Pronunciation practice with speech recognition
- Images on cards
- Browser extension / share-sheet capture of words from articles
- Native iOS wrapper if PWA limitations become blocking
