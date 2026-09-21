# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Project

**Annette Cards** is a Duocards-style vocabulary trainer: users learn words from their own dictionaries using
spaced repetition (FSRS) and native pronunciation. It is an **offline-first PWA** optimized for iPhone (Safari,
installed to the Home Screen) with a **lightweight Rust backend** for accounts, sync, audio generation and AI
enrichment.

- Users: the owner plus a few family members/friends. Registration is invite-only. Not a public service.
- Study languages: any (deck-level setting). First targets: English, then Polish. Native language: Russian.
- UI languages: Russian and English.

Read these before non-trivial work:

| Document | What it covers |
| --- | --- |
| `docs/plan.md` | Phases, tasks, acceptance criteria. **Source of truth for what to do next.** |
| `docs/architecture.md` | Components, data model, sync protocol, API, study engine, deployment |
| `docs/tech_stack.md` | Chosen libraries and why; rejected alternatives |
| `docs/ui_ux.md` | Screens, navigation, gestures, states |
| `docs/use_cases.md` | Use cases UC-01…UC-30 with flows and alternatives |

## Repository layout

```
annette-cards/
├── CLAUDE.md
├── README.md
├── justfile              # all dev commands
├── .editorconfig
├── .github/workflows/    # ci.yml (lint + test), release.yml (musl binary on tag)
├── docs/
├── dev/                  # meta-prompts; dev/impl/ = step-by-step task prompts per phase
├── web/                  # React 19 + Vite + TypeScript PWA (pnpm)
│   ├── src/
│   │   ├── app/          # router, providers, layout
│   │   ├── features/     # today, decks, cards, import, study, stats, settings, auth, sync
│   │   ├── domain/       # pure TS: scheduler, session builder, answer checking, CSV parsing
│   │   ├── db/           # Dexie schema, repositories, outbox
│   │   ├── api/          # orval-generated client (do not edit by hand)
│   │   ├── i18n/         # en.json, ru.json
│   │   ├── components/   # shared + shadcn/ui
│   │   └── lib/
│   └── tests/e2e/        # Playwright
├── server/               # Rust (axum + sqlx + SQLite)
│   ├── migrations/
│   ├── .sqlx/            # sqlx offline query metadata (committed)
│   └── src/
│       ├── main.rs       # clap CLI: serve | create-user | invite | openapi
│       ├── app.rs        # router assembly
│       ├── config.rs  error.rs  db.rs
│       ├── auth/  sync/  audio/  enrich/  push/  admin/  fsrs/
│       └── static_files.rs   # embedded PWA (rust-embed)
└── deploy/               # Caddyfile, systemd unit, litestream.yml
```

## Commands

Use `just` from the repo root. Do not invent ad-hoc command sequences if a recipe exists.

| Command | Purpose |
| --- | --- |
| `just dev` | Run server (bacon) and Vite dev server together; Vite proxies `/api` to `127.0.0.1:8080` |
| `just dev-web` / `just dev-server` | Run one side only |
| `just dev-https` | Vite over HTTPS on the LAN for testing on iPhone |
| `just test` | `cargo test` + `pnpm vitest run` |
| `just e2e` | Playwright tests (WebKit project is mandatory) |
| `just lint` | `cargo clippy -- -D warnings`, `cargo fmt --check`, `pnpm biome check`, `pnpm tsc --noEmit` |
| `just fmt` | Format Rust and TS |
| `just gen-api` | `server openapi > web/openapi.json` then `pnpm orval` |
| `just db-new <name>` | New sqlx migration |
| `just db-migrate` | Create the local DB and apply migrations |
| `just sqlx-prepare` | Refresh `.sqlx/` offline metadata after changing any `query!` |
| `just build` | Build web, embed into server, release binary |
| `just release` | `cargo zigbuild --release --target x86_64-unknown-linux-musl` |
| `just deploy` | Copy binary to VPS and restart the systemd service |

## Workflow

1. Find the current phase and the first unchecked task in `docs/plan.md`. Work on one task at a time.
   Step-by-step task prompts live in `dev/impl/` (start from `dev/impl/00-overview.md`); each plan subsection
   links to its task file. `docs/plan.md` stays the source of truth for status.
2. If a task is ambiguous or conflicts with the docs, ask before implementing.
3. Implement with tests. Run `just lint` and `just test` before declaring the task done.
4. Tick the task checkbox in `docs/plan.md`. If behavior, schema or API changed, update the relevant doc in the
   same change.
5. Commit using Conventional Commits (`feat(web): …`, `fix(server): …`, `docs: …`).

Definition of done: code + tests + lint clean + docs updated + works offline in WebKit (for client features).

## Architectural invariants (do not break)

- **Offline-first.** UI components never call the HTTP API to read or write user data. All reads/writes go through
  repositories in `web/src/db/`. The API is used only by the sync engine, auth, audio and enrich features.
- **Every local mutation** sets `updated_at` (ms since epoch), `updated_by` (device id) and adds an outbox entry,
  inside one Dexie transaction.
- **IDs are UUIDv7**, generated on the client (or server for server-only entities).
- **Deletes are soft** (`deleted_at`) for all synced entities. Physical purge only by server maintenance job.
- **`review_log` is append-only.** The only allowed change is a soft delete for "undo last answer".
- **FSRS scheduling runs on the client** (`ts-fsrs`). The server never recalculates intervals; it only stores
  states and logs and (Phase 4) optimizes FSRS weights.
- **Every server query touching user data filters by `user_id`** from the authenticated session. Ownership of
  parent entities (deck of a card, card of a state) is validated on push.
- **No user-visible strings from the server.** The server returns stable error codes (`"invalid_credentials"`);
  the client localizes them.
- **No hardcoded UI strings.** Everything goes through `react-i18next` with keys in both `en.json` and `ru.json`.
- **Secrets live only on the server** (TTS, LLM, VAPID keys). Never ship them to the client.

## Conventions

### Rust (server)

The owner is **learning Rust** with this project. Therefore:

- Write idiomatic but approachable code: prefer clear structs/enums and small functions over clever generics,
  macro tricks or lifetime gymnastics. Cloning a small `String` is fine if it keeps the code readable.
- When a change introduces a Rust concept not yet used in the codebase (traits with async, `Arc<AppState>`,
  extractors, `?` with custom errors, lifetimes, etc.), explain it briefly in the task summary, not in long
  code comments.
- Errors: `thiserror` enum `AppError` implementing `IntoResponse`; `anyhow` only in `main.rs`/CLI and startup.
- DB access: `sqlx::query!` / `query_as!` (compile-time checked). No ORMs. Keep SQL in the module that owns it.
- Handlers are thin: extract → call a service function → map to response DTO. DTOs derive `Serialize`,
  `Deserialize`, `utoipa::ToSchema`.
- Timestamps are `i64` milliseconds since epoch everywhere in the DB and API.
- Tests: `#[sqlx::test]` with migrations for DB code; router tests via `tower::ServiceExt::oneshot`.
- `cargo clippy -- -D warnings` must pass. Edition 2024.

### TypeScript (web)

- Strict TS. No `any` except in generated code.
- Pure logic lives in `src/domain/` and is unit-tested without React or Dexie.
- Data hooks use Dexie `useLiveQuery`; server calls use TanStack Query with the orval client.
- Components: shadcn/ui primitives + Tailwind. Mobile-first; respect iOS safe areas (`env(safe-area-inset-*)`).
- Never edit `src/api/` by hand; run `just gen-api`.
- Tests: Vitest + Testing Library; `fake-indexeddb` for repository tests; Playwright (WebKit) for flows.

### General

- Add a dependency only when it removes real work; mention it in `docs/tech_stack.md`.
- Keep functions small; prefer explicit names over comments.
- Do not add features that are not in `docs/plan.md` without asking.

## iOS / Safari gotchas

- Speech synthesis must be first triggered by a user gesture; voices load asynchronously (`voiceschanged`).
- Call `navigator.storage.persist()` on first run; Safari may evict data of non-installed sites.
- Web Push works only for Home-Screen-installed PWAs (iOS 16.4+).
- `navigator.vibrate` is not supported on iOS — do not rely on haptics.
- Test in the Playwright **WebKit** project and on a real iPhone before closing client-side phases.



## Behavioral Guidelines

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

### 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:

- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

### 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:

- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:

- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

### 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:

- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:

```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and
clarifying questions come before implementation rather than after mistakes.

---
