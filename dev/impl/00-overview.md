# Implementation plan — overview

Step-by-step, executable task prompts for building Annette Cards. Generated from `docs/plan.md`,
`docs/architecture.md`, `docs/tech_stack.md`, `docs/ui_ux.md`, `docs/use_cases.md`, `CLAUDE.md` and `README.md`
by the meta-prompt `dev/000-impl-plan.md`.

## How to use

- Execute tasks strictly in order: phase by phase, task by task.
- Start each task in a fresh Claude Code session: "Execute `dev/impl/phase-XX-…/task-YY-….md`".
- A task is done only when its Definition of done is met and it is committed (one Conventional Commit on `main`).
- `docs/plan.md` remains the source of truth for status (checkboxes). Each task ticks the checkboxes it covers.
- Items marked `(added)` were not in the original `plan.md`; they came from the coverage analysis below and were
  added to `plan.md` as checkboxes.

## Phases

| # | Directory | Goal | Tasks | Use cases | Depends on |
| --- | --- | --- | --- | --- | --- |
| 0 | [`phase-00-bootstrap`](phase-00-bootstrap/00-phase-overview.md) | Monorepo skeleton, tooling, CI | 4 | — | — |
| 1 | [`phase-01-local-mvp`](phase-01-local-mvp/00-phase-overview.md) | Study own words on iPhone offline | 14 | UC-01, 05–08, 10–12, 16–18, 21, 22, 24, 26, 27 | 0 |
| 2 | [`phase-02-backend-sync`](phase-02-backend-sync/00-phase-overview.md) | Accounts, multi-device sync, deployment | 10 | UC-02–04, 20, 25, 28, 29 | 1 |
| 3 | [`phase-03-audio-ai`](phase-03-audio-ai/00-phase-overview.md) | Server audio and AI enrichment | 6 | UC-09, 13 | 2 |
| 4 | [`phase-04-polish`](phase-04-polish/00-phase-overview.md) | More modes, stats, reminders, FSRS optimization, quality | 8 | UC-14, 15, 19, 23, 30 | 3 |

No additional phase was needed: every architecture item fits an existing subsection (see the coverage matrix).

## Task index

Split subsections are marked with a letter (e.g. `1.2a`); the reason is given in each phase overview.

| ID | Task | Plan section | Main area |
| --- | --- | --- | --- |
| P0-T01 | [Repository and tooling](phase-00-bootstrap/task-01-repo-tooling.md) | 0 · Repository and tooling | repo, CI |
| P0-T02 | [Web skeleton](phase-00-bootstrap/task-02-web-skeleton.md) | 0 · Web skeleton | web |
| P0-T03 | [Server skeleton](phase-00-bootstrap/task-03-server-skeleton.md) | 0 · Server skeleton | server |
| P0-T04 | [Phase 0 acceptance](phase-00-bootstrap/task-04-phase-acceptance.md) | 0 · Acceptance | all |
| P1-T01 | [Data layer](phase-01-local-mvp/task-01-data-layer.md) | 1.1 | web (domain, db) |
| P1-T02 | [Decks list and card states](phase-01-local-mvp/task-02-decks-list.md) | 1.2a | web |
| P1-T03 | [Card editor and quick add](phase-01-local-mvp/task-03-card-editor-quick-add.md) | 1.2b | web |
| P1-T04 | [Deck detail and card view](phase-01-local-mvp/task-04-deck-detail-card-view.md) | 1.2c | web |
| P1-T05 | [CSV import](phase-01-local-mvp/task-05-csv-import.md) | 1.3a | web |
| P1-T06 | [Export and backup restore](phase-01-local-mvp/task-06-export-backup.md) | 1.3b | web |
| P1-T07 | [Scheduler and session builder](phase-01-local-mvp/task-07-scheduler-session-builder.md) | 1.4a | web (domain) |
| P1-T08 | [Answers, undo, practice](phase-01-local-mvp/task-08-answers-undo-practice.md) | 1.4b | web (domain, db) |
| P1-T09 | [Study session and swipe cards](phase-01-local-mvp/task-09-study-session-swipe.md) | 1.5a | web |
| P1-T10 | [Today and session summary](phase-01-local-mvp/task-10-today-summary.md) | 1.5b | web |
| P1-T11 | [Speech](phase-01-local-mvp/task-11-speech.md) | 1.6 | web |
| P1-T12 | [Settings and install](phase-01-local-mvp/task-12-settings-install.md) | 1.7a | web |
| P1-T13 | [Onboarding and offline](phase-01-local-mvp/task-13-onboarding-offline.md) | 1.7b | web |
| P1-T14 | [Phase 1 acceptance](phase-01-local-mvp/task-14-phase-acceptance.md) | 1 · Acceptance | web |
| P2-T01 | [Auth core](phase-02-backend-sync/task-01-auth-core.md) | 2.1a | server |
| P2-T02 | [Invites and security](phase-02-backend-sync/task-02-invites-security.md) | 2.1b | server |
| P2-T03 | [Sync schema and push](phase-02-backend-sync/task-03-sync-push.md) | 2.2a | server |
| P2-T04 | [Sync pull and export](phase-02-backend-sync/task-04-sync-pull-export.md) | 2.2b | server |
| P2-T05 | [Auth screens](phase-02-backend-sync/task-05-auth-screens.md) | 2.3a | web |
| P2-T06 | [Sync engine](phase-02-backend-sync/task-06-sync-engine.md) | 2.3b | web |
| P2-T07 | [First sign-in and sign-out](phase-02-backend-sync/task-07-first-signin-signout.md) | 2.3c | web |
| P2-T08 | [Deploy artifacts](phase-02-backend-sync/task-08-deploy-artifacts.md) | 2.4a | deploy |
| P2-T09 | [VPS provisioning and ops](phase-02-backend-sync/task-09-vps-provisioning.md) | 2.4b | deploy |
| P2-T10 | [Phase 2 acceptance](phase-02-backend-sync/task-10-phase-acceptance.md) | 2 · Acceptance | all |
| P3-T01 | [TTS audio (server)](phase-03-audio-ai/task-01-tts-audio-server.md) | 3.1a | server |
| P3-T02 | [Commons recordings](phase-03-audio-ai/task-02-commons-recordings.md) | 3.1b | server |
| P3-T03 | [Client audio](phase-03-audio-ai/task-03-client-audio.md) | 3.2 | web |
| P3-T04 | [Enrichment (server)](phase-03-audio-ai/task-04-enrich-server.md) | 3.3a | server |
| P3-T05 | [Enrichment (client)](phase-03-audio-ai/task-05-enrich-client.md) | 3.3b | web |
| P3-T06 | [Phase 3 acceptance](phase-03-audio-ai/task-06-phase-acceptance.md) | 3 · Acceptance | all |
| P4-T01 | [Typing mode](phase-04-polish/task-01-typing-mode.md) | 4.1a | web (domain) |
| P4-T02 | [Choice and listening modes](phase-04-polish/task-02-choice-listening-modes.md) | 4.1b | web |
| P4-T03 | [Statistics](phase-04-polish/task-03-statistics.md) | 4.2 | web |
| P4-T04 | [Reminders](phase-04-polish/task-04-reminders.md) | 4.3 | server, web |
| P4-T05 | [FSRS optimization](phase-04-polish/task-05-fsrs-optimization.md) | 4.4 | server, web |
| P4-T06 | [Accessibility and performance](phase-04-polish/task-06-accessibility-performance.md) | 4.5a | web |
| P4-T07 | [Purge and docs](phase-04-polish/task-07-purge-docs.md) | 4.5b | server, docs |
| P4-T08 | [Phase 4 acceptance](phase-04-polish/task-08-phase-acceptance.md) | 4 · Acceptance | all |

## Checkbox assignment

Each `plan.md` checkbox belongs to exactly one task.

| Task | Checkboxes from `plan.md` |
| --- | --- |
| P0-T01 | Repo structure · `justfile` recipes · GitHub Actions |
| P0-T02 | Vite+React+TS · Tailwind/shadcn/lucide/dark mode · TanStack Router · i18next · Biome/Vitest/Playwright · `vite-plugin-pwa` · Vite proxy |
| P0-T03 | Cargo project · `clap` CLI · figment/tracing/AppState/AppError · SQLite pool · health/meta · utoipa + `gen-api` · `rust-embed` |
| P1-T01 | Domain types · Dexie schema v1 · Repositories · Settings repository |
| P1-T02 | Decks list (S-05) · Card state creation per active direction |
| P1-T03 | Card editor (S-08) · Quick add sheet (S-09) |
| P1-T04 | Deck detail (S-06) · Card view (S-07) |
| P1-T05 | CSV/TSV parser in a Web Worker · Import wizard (S-10) |
| P1-T06 | Export (JSON + CSV) · Import of JSON backup |
| P1-T07 | `ts-fsrs` wrapper · Study-day calculation · Session builder |
| P1-T08 | Answer transaction · Undo last answer · Practice mode · Unit tests (queue, limits, day boundary, burying, undo) |
| P1-T09 | Study session shell (S-11) · Swipe cards with `motion` |
| P1-T10 | Today (S-04) · Session summary (S-12) · Reduced-motion variants and VoiceOver labels |
| P1-T11 | Speech service · Autoplay settings · Voices screen (S-16) · Missing-voice warning |
| P1-T12 | Settings (S-14) · Install hint and `storage.persist()` |
| P1-T13 | Onboarding (S-01) · Offline verification |
| P2-T01 | Migrations users/invites/sessions · CLI `create-user`/`invite` · Argon2id + login/logout/logout-others/me/password · Session cookie, `CurrentUser`, sliding expiry, cleanup |
| P2-T02 | Register with invite · Admin invite endpoints · Origin check, rate limiting, security headers · Integration tests for all auth flows |
| P2-T03 | Migrations for sync tables · `server_seq` allocation · Push |
| P2-T04 | Pull · Export endpoint and restore · Two-device convergence tests |
| P2-T05 | Auth screens (S-02) and Account & sync (S-15) incl. admin invites |
| P2-T06 | Sync engine · LWW merge into Dexie, outbox clearing, error log, clock skew · Sync indicator |
| P2-T07 | First sign-in (S-03) · Sign-out with warning and wipe · E2E two contexts |
| P2-T08 | `deploy/` files · `just release` and `just deploy` |
| P2-T09 | Provision VPS · Restore drill · Uptime check |
| P3-T01 | `audio_assets` + `GET /api/audio/{id}` · `TtsProvider` + Azure · Card update, rate limiting, feature flags |
| P3-T02 | Wikimedia Commons lookup · Verify OGG playback / transcoding decision |
| P3-T03 | Pronunciation section · Playback chain · Workbox audio cache + prefetch · Clear cached audio and storage usage |
| P3-T04 | `Enricher` + Anthropic · Daily quota · Prompt tuned for EN→RU and PL→RU |
| P3-T05 | "Fill with AI" in card editor · Quick add with suggestions |
| P4-T01 | Typing mode |
| P4-T02 | Multiple choice · Listening mode · Mode selector on Today |
| P4-T03 | Statistics screen (S-13) · Streak logic based on study days |
| P4-T04 | VAPID + `push_subscriptions` + endpoints · Reminder task · Client permission flow |
| P4-T05 | Optimize endpoint (`fsrs` crate) · Client Optimize button and apply |
| P4-T06 | Accessibility pass · Performance pass |
| P4-T07 | Purge job · Documentation refresh |

Phase-acceptance tasks (P0-T04, P1-T14, P2-T10, P3-T06, P4-T08) cover the **Acceptance** paragraph of each phase.

## Decisions on inconsistencies between documents

None of these blocked generation. Each is resolved inside the named task, which also updates the docs.

| # | Inconsistency | Resolution | Task |
| --- | --- | --- | --- |
| D1 | `.gitignore` ignores `Cargo.lock`, but `tech_stack.md` says to pin it (and the server is a binary) | Remove `Cargo.lock` from `.gitignore` | P0-T01 |
| D2 | UC-16 says practice answers are logged with a "practice flag", but `review_log` has no such column | Add `practice` (boolean; `INTEGER 0/1` on server) to `review_log` in domain, Dexie, §5.4 and the push payload | P1-T08 (client), P2-T03 (server) |
| D3 | S-14 has "directions default" and "show IPA on front"; S-11 listening can be answered by "choose or type"; S-14 shows "last optimized date" — none of these are in the settings document §5.5 | Add `default_directions`, `show_ipa_on_front` (P1-T01), `listening_answer: 'choose' \| 'type'` (P4-T02), `fsrs_optimized_at` (P4-T05) to §5.5 | as listed |
| D4 | S-04 Today shows mode chips in Phase 1, but modes other than Swipe arrive in Phase 4 | Phase 1 Today has no mode selector; P4-T02 adds it | P1-T10, P4-T02 |
| D5 | Today shows a streak in Phase 1, but "Streak logic based on study days" is a Phase 4 checkbox | P1-T10 implements a minimal `domain/streak.ts` (current streak) for Today; P4-T03 completes it (longest streak, heatmap, study-day edge cases) and owns the checkbox | P1-T10, P4-T03 |
| D6 | S-03 needs server-side counts ("In your account: 3 decks, 1 210 cards"), but no API returns them (UC-04 says "first pull page", which has no totals) | Add `GET /api/sync/summary` → `{decks, cards}` counts of non-deleted rows | P2-T04 |
| D7 | `architecture.md` §5.1 and `tech_stack.md` list a `purge` CLI subcommand; `CLAUDE.md` does not | Add `purge` subcommand with the purge job; update `CLAUDE.md` | P4-T07 |
| D8 | `README.md` mentions `just dev-https` and `server/.env.example`; neither is in `plan.md` or the Commands table | Add `dev-https` recipe (P0-T01) and `.env.example` (P0-T03); update `CLAUDE.md` Commands | P0-T01, P0-T03 |
| D9 | UC-25 "Restore a backup" is labelled Phase 2, but the plan puts JSON backup import in 1.3 | Follow `plan.md`: local restore in P1-T06; server-side restore endpoint in P2-T04 | P1-T06, P2-T04 |
| D10 | S-08 duplicate check and UC-10 import use a "normalized front" that is not defined | Define `normalizeFront` in `domain/` (NFC, trim, lowercase, collapse spaces) in P1-T03, reuse in P1-T05; P4-T01 extends normalization for typing answers | P1-T03 |

## Coverage matrix

Every item that must exist in the finished system, mapped to the task that implements it.

### Architecture

| Source item | Task ID | Note |
| --- | --- | --- |
| §1 Goals, non-goals | — | Constraints; enforced by CLAUDE.md invariants |
| §2 System context: Azure, Commons, Anthropic, Web Push, S3 | P3-T01, P3-T02, P3-T04, P4-T04, P2-T09 | |
| §3 Containers (UI, domain, repositories, sync, speech, SW, services, jobs) | P0-T02, P0-T03, P1-T01, P2-T06, P1-T11 | |
| §4.1 Client layers | P0-T02 (folders), all web tasks | |
| §4.2 Dexie schema v1 | P1-T01 | |
| §4.2 Device-local preferences in `meta` (voice, rate, theme, prefetch) | P1-T01, P1-T11, P1-T12, P3-T03 | |
| §4.3 Write path (transaction, outbox, debounced sync) | P1-T01, P2-T06 | |
| §4.4 FSRS config | P1-T07 | |
| §4.4 Directions | P1-T02 | |
| §4.4 Day boundary | P1-T07 | |
| §4.4 Session queue (due, new, interleave, bury, learning re-insertion) | P1-T07 | |
| §4.4 Answer → rating mapping: swipe | P1-T09 | |
| §4.4 Answer → rating mapping: choice, listening | P4-T02 | |
| §4.4 Typing normalization and tolerance (`domain/answer.ts`) | P4-T01 | |
| §4.4 Answer transaction | P1-T08 | |
| §4.4 Undo | P1-T08 | |
| §4.5 Speech (voices, best voice, gesture, `lang`, example) | P1-T11 | |
| §4.5 Playback chain with cached MP3 | P3-T03 | |
| §4.5 Audio prefetch (`audio-v1`) | P3-T03 | |
| §4.6 i18n setup, plurals | P0-T02 | |
| §4.6 Initial UI language detection | P0-T02, P1-T12 | |
| §4.6 Server error codes → `errors.<code>` | P2-T05 | |
| §4.6 Dates/numbers via `Intl` | P1-T02 (added helpers), all web tasks | |
| §4.7 Manifest, iOS meta, precache, update prompt | P0-T02 | |
| §4.7 Runtime caching `/api/audio/*` | P3-T03 | |
| §4.7 `/api/*` NetworkOnly | P0-T02 | |
| §4.7 `storage.persist()` + warning | P1-T12 | |
| §4.7 Install hint | P1-T12 | |
| §5.1 `main.rs` CLI `serve`, `openapi` | P0-T03 | |
| §5.1 CLI `create-user`, `invite` | P2-T01 | |
| §5.1 CLI `purge` | P4-T07 | (added) D7 |
| §5.1 `config.rs`, `app.rs`, `error.rs`, `db.rs` | P0-T03 | |
| §5.1 `auth/` | P2-T01 | |
| §5.1 `admin/` | P2-T02 | |
| §5.1 `sync/` | P2-T03, P2-T04 | |
| §5.1 `audio/` | P3-T01, P3-T02 | |
| §5.1 `enrich/` | P3-T04 | |
| §5.1 `push/` | P4-T04 | |
| §5.1 `fsrs/` | P4-T05 | |
| §5.1 `static_files.rs` | P0-T03 | |
| §5.2 Trace, compression, 30 s timeout layers | P0-T03 | (added) |
| §5.2 Origin check, route-specific rate limiter | P2-T02 | |
| §5.3 `GET /api/health`, `GET /api/meta` | P0-T03 | |
| §5.3 `GET /api/openapi.json` | P0-T03 | (added) |
| §5.3 `POST /api/auth/login`, `logout`, `logout-others`, `GET me`, `POST password` | P2-T01 | |
| §5.3 `POST /api/auth/register` | P2-T02 | |
| §5.3 `GET/POST/DELETE /api/admin/invites` | P2-T02 | |
| §5.3 `POST /api/sync/push` | P2-T03 | |
| §5.3 `GET /api/sync/pull` | P2-T04 | |
| `GET /api/sync/summary` | P2-T04 | (added) D6 |
| §5.3 `GET /api/export`, `POST /api/import/json` | P2-T04 | |
| §5.3 `POST/DELETE /api/cards/{id}/audio` (`tts`), `GET /api/audio/{id}` | P3-T01 | |
| §5.3 `POST /api/cards/{id}/audio` (`commons`) | P3-T02 | |
| §5.3 `POST /api/enrich` | P3-T04 | |
| §5.3 `POST/DELETE /api/push/subscribe` | P4-T04 | |
| §5.3 `POST /api/fsrs/optimize` | P4-T05 | |
| §5.3 Error response `{code, details}` | P0-T03 | |
| §5.4 `users`, `invites`, `sessions` | P2-T01 | |
| §5.4 `sync_seq`, `decks`, `cards`, `card_states`, `review_log`, `user_settings` + indexes | P2-T03 | |
| §5.4 `audio_assets` | P3-T01 | |
| §5.4 `enrich_usage` | P3-T04 | |
| §5.4 `push_subscriptions` | P4-T04 | |
| §5.5 Settings document (+ D3 fields) | P1-T01, P4-T02, P4-T05 | |
| §6.1 LWW, cursor, append-only log, soft-delete propagation | P2-T03, P2-T06 | |
| §6.1 Deleted deck → client marks cards deleted | P1-T02 | (added) |
| §6.1 Clock skew warning | P2-T06 | |
| §6.2 Sequence (push then pull loop) | P2-T06 | |
| §6.3 Payloads, 500-row batches, dependency order | P2-T03, P2-T04, P2-T06 | |
| §6.4 Triggers | P2-T06 | |
| §6.4 First sign-in, sign-out wipe | P2-T07 | |
| §7 Audio pipeline (TTS, SSML, IPA phoneme) | P3-T01 | |
| §7 Commons + format | P3-T02 | |
| §7 Rate limit 60/h | P3-T01 | |
| §8 Enrichment, retry, quota | P3-T04 | |
| §9 HTTPS, HSTS | P2-T08 | |
| §9 Argon2id, min length 10, login rate limit | P2-T01, P2-T02 | |
| §9 Session token/cookie attributes | P2-T01 | |
| §9 CSRF (SameSite + Origin) | P2-T01, P2-T02 | |
| §9 `user_id` filter, parent ownership on push | P2-T03 | |
| §9 Body size 2 MB, field length limits | P2-T03 | (added) |
| §9 Secrets in env readable by service user | P2-T08 | |
| §9 CSP, `X-Content-Type-Options`, `Referrer-Policy` | P2-T02 | |
| §10 Base config (`BIND`, `DATABASE_URL`, `PUBLIC_URL`, `SESSION_TTL_DAYS`, `RUST_LOG`) | P0-T03, P2-T01 | |
| §10 `server/.env.example` | P0-T03 | (added) D8; each later task adds its variables |
| §10 Azure, Commons, Anthropic, LLM model, enrich limit, VAPID vars | P3-T01, P3-T02, P3-T04, P4-T04 | |
| §11 Session cleanup (hourly) | P2-T01 | |
| §11 Reminders (every minute) | P4-T04 | |
| §11 Purge (daily) | P4-T07 | |
| §12 Release layout, symlink, systemd hardening, Caddy | P2-T08 | |
| §12 Litestream, restore procedure | P2-T08, P2-T09 | |
| §12 Migrations on startup | P0-T03 | |
| §13 JSON logs in prod, request id, hashed user id | P2-T02 | (added) |
| §13 `/api/health` DB ping | P0-T03 | |
| §13 Client sync errors + last sync time | P2-T06 | |
| §14 ADRs | — | Decisions; respected by all tasks |
| §15 OGG playback in iOS Safari | P3-T02 | Decision step, recorded in `architecture.md` |
| §15 Shareable decks | — | backlog, not planned |
| §15 1 GB SQLite size limit | P4-T06 | (added) measure and record decision |

### Screens and UI

| Source item | Task ID | Note |
| --- | --- | --- |
| §2 Visual language, theme, safe areas | P0-T02, P1-T12 (theme override) | |
| §3 Bottom tab bar, routes, deep links | P0-T02 | |
| §3 Deep link `/study?deck=&mode=` handling | P1-T09 | (added) |
| §3 Floating "+" → Quick add | P1-T03 | |
| §4 Sync indicator | P2-T06 | |
| §4 Snackbar, Confirm sheet, Empty states | P1-T02 | (added) shared components |
| §4 Update banner | P0-T02 | |
| §4 Install hint | P1-T12 | |
| §4 Offline hint ("Available online") | P2-T05 | (added) shared component |
| S-01 Onboarding | P1-T13 | "I have an account": P2-T05 |
| S-02 Sign in / Register (incl. `?invite=`) | P2-T05 | |
| S-03 First sync choice | P2-T07 | |
| S-04 Today | P1-T10 | Mode chips: P4-T02 (D4) |
| S-04 "Learn extra new words" (+10), "Practice difficult words" | P1-T10 | (added) explicit |
| S-05 Decks list (swipe row, long-press menu, archived section) | P1-T02 | |
| S-06 Deck detail | P1-T04 | |
| S-06 Multi-select (move, tag, reset, delete) | P1-T04 | (added) |
| S-07 Card view (incl. last 10 answers history) | P1-T04 | |
| S-07 Pronunciation section | P3-T03 | |
| S-08 Card editor | P1-T03 | |
| S-08 "Fill with AI" | P3-T05 | |
| S-09 Quick add | P1-T03 | AI suggestions: P3-T05 |
| S-10 Import wizard | P1-T05 | |
| S-11 Session shell, start gate, resume within 30 min | P1-T09 | |
| S-11 Mode A swipe | P1-T09 | |
| S-11 Long text auto-shrink | P1-T09 | (added) |
| S-11 Mode B choice, Mode C listening | P4-T02 | |
| S-11 Mode D typing | P4-T01 | |
| S-12 Session summary | P1-T10 | |
| S-13 Statistics | P4-T03 | |
| S-14 Settings: study, audio, appearance, data, about | P1-T12 | |
| S-14 About: server version | P2-T05 | (added) |
| S-14 About: Wikimedia attributions list | P3-T03 | (added) |
| S-14 Reminders | P4-T04 | |
| S-14 FSRS Optimize | P4-T05 | |
| S-14 Storage usage, Clear cached audio | P3-T03 | |
| S-15 Account & sync: auth parts, admin invites | P2-T05 | |
| S-15 Sync status, sync now, sync log | P2-T06 | |
| S-16 Voices | P1-T11 | |
| §6 Gestures: tap/swipe/swipe up (study) | P1-T09 | |
| §6 Swipe row, long-press (lists) | P1-T02, P1-T04 | |
| §6 Pull down: reveal search | P1-T02, P1-T04 | |
| §6 Pull down on Today: sync now | P2-T06 | (added) |
| §6 Edge swipe back | P0-T02 | |
| §7 Feedback and edge cases | P1-T02, P1-T09, P1-T11, P1-T12, P2-T06, P3-T05 | per row |
| §8 Accessibility (buttons for swipes, VoiceOver, reduced motion) | P1-T09, P1-T10 | |
| §8 Contrast, dynamic type 200 % | P4-T06 | |
| §9 Plurals, `Intl.DisplayNames`, `Intl.RelativeTimeFormat` | P0-T02, P1-T02 | |

### Use cases

| Use case | Task ID |
| --- | --- |
| UC-01 First run and onboarding | P1-T13 |
| UC-02 Register with an invite | P2-T02, P2-T05 |
| UC-03 Sign in and sign out | P2-T01, P2-T05, P2-T07 |
| UC-04 First sign-in with local data | P2-T04, P2-T07 |
| UC-05 Manage decks | P1-T02, P1-T04 |
| UC-06 Quick add a word | P1-T03 |
| UC-07 View, edit, delete a card | P1-T03, P1-T04 |
| UC-08 Daily review from Today | P1-T07, P1-T10 |
| UC-09 Add a word with AI | P3-T04, P3-T05 |
| UC-10 Import CSV/TSV | P1-T05 |
| UC-11 Swipe study session | P1-T08, P1-T09 |
| UC-12 Listen to pronunciation | P1-T11, P3-T03 |
| UC-13 Fix pronunciation | P3-T01, P3-T02, P3-T03 |
| UC-14 Multiple-choice and listening | P4-T02 |
| UC-15 Typing mode | P4-T01 |
| UC-16 Practice difficult words | P1-T08, P1-T10 |
| UC-17 Undo last answer | P1-T08, P1-T09 |
| UC-18 Study offline | P1-T13 |
| UC-19 View statistics | P4-T03 |
| UC-20 Sync between devices | P2-T03, P2-T04, P2-T06 |
| UC-21 Configure study settings | P1-T12 |
| UC-22 Choose a voice | P1-T11 |
| UC-23 Receive study reminders | P4-T04 |
| UC-24 Export a backup | P1-T06 |
| UC-25 Restore a backup | P1-T06, P2-T04 |
| UC-26 Install on iPhone | P1-T12 |
| UC-27 Switch UI language | P0-T02, P1-T12 |
| UC-28 Invite a user | P2-T01, P2-T02, P2-T05 |
| UC-29 Operate the server | P2-T08, P2-T09 |
| UC-30 Optimize FSRS parameters | P4-T05 |

### Commands and setup

| Source item | Task ID | Note |
| --- | --- | --- |
| `just dev`, `dev-web`, `dev-server`, `test`, `e2e`, `lint`, `fmt`, `gen-api`, `db-new`, `db-migrate`, `sqlx-prepare`, `build` | P0-T01 (recipes), P0-T02/T03 (working) | |
| `just release`, `just deploy` | P0-T01 (stubs), P2-T08 (implemented) | |
| `just dev-https` | P0-T01 | (added) D8 |
| `.editorconfig`, `.gitignore` fix | P0-T01 | D1 |
| `server/.env.example` | P0-T03 | (added) D8 |
| CI lint + test, release on tag | P0-T01 | |

### Libraries (`tech_stack.md`)

| Library | Task ID |
| --- | --- |
| React 19, Vite, TS, pnpm, TanStack Router, Tailwind 4, shadcn/ui, lucide-react, i18next, Biome, Vitest, Testing Library, Playwright, `vite-plugin-pwa` | P0-T02 |
| Dexie, `uuid` (v7), `fake-indexeddb` | P1-T01 |
| `motion` | P1-T09 |
| `ts-fsrs`, date-fns | P1-T07 |
| PapaParse | P1-T05 |
| TanStack Query, orval client usage | P2-T05 |
| Recharts | P4-T03 |
| In-house Damerau–Levenshtein | P4-T01 |
| tokio, axum, tower-http, sqlx, serde, utoipa, thiserror, anyhow, tracing, figment, clap, rust-embed, uuid | P0-T03 |
| argon2, rand, sha2, axum-extra cookies | P2-T01 |
| `tower_governor` | P2-T02 |
| reqwest (rustls) | P3-T01 |
| `web-push` | P4-T04 |
| `fsrs` (fsrs-rs) | P4-T05 |
| bacon, sqlx-cli, cargo-zigbuild | P0-T01, P2-T08 |
| Distroless container image | — | optional per `tech_stack.md`, not planned |

### Backlog (not planned)

| Item | Status |
| --- | --- |
| Shared decks between users | backlog, not planned |
| Pronunciation practice with speech recognition | backlog, not planned |
| Images on cards | backlog, not planned |
| Browser extension / share-sheet capture | backlog, not planned |
| Native iOS wrapper | backlog, not planned |

## Added items for owner review

- P0-T01: remove `Cargo.lock` from `.gitignore` (D1); `just dev-https` recipe (D8).
- P0-T03: `server/.env.example` (D8); tower-http trace, compression and 30 s timeout layers (§5.2);
  `GET /api/openapi.json` endpoint (§5.3).
- P1-T01: settings fields `default_directions`, `show_ipa_on_front` (D3).
- P1-T02: shared Snackbar, Confirm sheet, Empty state components; `Intl` helpers (language names, relative
  dates); deck soft delete cascades to its cards (§6.1).
- P1-T03: `normalizeFront` domain function (D10).
- P1-T04: multi-select actions in deck detail (S-06).
- P1-T08: `practice` flag on `review_log` (D2).
- P1-T09: deep link `/study?deck=&mode=&practice=1` handling; long-text auto-shrink on cards.
- P1-T10: "Learn extra new words" and "Practice difficult words" entry points; minimal current-streak function
  (D5); no mode chips yet (D4).
- P1-T11: speaker buttons in deck rows, card view, card editor and study card.
- P1-T12: Settings → About (app version, licenses).
- P1-T13: "I have an account" hidden in Phase 1; P2-T05 shows it.
- P2-T02: JSON logs in production, request id, hashed user id in request spans (§13).
- P2-T03: request body limit 2 MB and field length limits (§9); `practice` column (D2).
- P2-T04: `GET /api/sync/summary` for S-03 counts (D6).
- P2-T05: shared Offline hint component; server version in About.
- P2-T05: "I have an account" button on onboarding.
- P2-T06: pull-down on Today triggers sync.
- P3-T01: `X-Audio-Source` / `X-Audio-Attribution` response headers (attribution reaches other devices, since only
  `audio_id` syncs); server-side card edits use `updated_by = 'server'`.
- P3-T03: Wikimedia attributions list in Settings → About.
- P4-T02: `listening_answer` setting (D3).
- P4-T05: `fsrs_optimized_at` setting (D3).
- P4-T06: measure DB size with audio and record the 1 GB decision (§15).
- P4-T07: `purge` CLI subcommand (D7).
