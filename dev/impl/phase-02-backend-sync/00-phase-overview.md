# Phase 2 — Backend and sync

**Goal:** accounts for the owner and a few invited users; data syncs between iPhone and laptop; server runs on
the VPS with backups.

**Use cases:** UC-02, UC-03, UC-04, UC-20, UC-25, UC-28, UC-29

**Screens:** S-02 Sign in / Register, S-03 First sync choice, S-15 Account & sync, sync indicator (global), S-14
About (server version)

**Prerequisites:**

- Phase 1 complete (P1-T14 accepted): local app with Dexie repositories and outbox entries for every mutation.
- Phase 0 server skeleton: `AppState`, `AppError`, SQLite pool, migrations on startup, utoipa + `just gen-api`.
- External resources the owner must have before P2-T08/P2-T09:
  - a VPS (Ubuntu LTS, 1–2 vCPU, 2 GB RAM) with SSH access;
  - a domain / subdomain pointing to the VPS (A/AAAA record), e.g. `cards.example.com`;
  - an S3-compatible bucket with access key/secret for Litestream;
  - an uptime monitor account (any HTTP checker, e.g. UptimeRobot / Better Stack / healthchecks).

## Tasks

| # | File | Scope (plan.md section) | Depends on | Est. size |
| --- | --- | --- | --- | --- |
| P2-T01 | [task-01-auth-core.md](task-01-auth-core.md) | 2.1a — migrations, CLI, Argon2id, login/logout/me/password, sessions | Phase 1 | L |
| P2-T02 | [task-02-invites-security.md](task-02-invites-security.md) | 2.1b — register, admin invites, origin/rate limit/headers, logging, auth tests | T01 | M |
| P2-T03 | [task-03-sync-push.md](task-03-sync-push.md) | 2.2a — sync tables, `server_seq`, push | T01 | L |
| P2-T04 | [task-04-sync-pull-export.md](task-04-sync-pull-export.md) | 2.2b — pull, summary, export/restore, convergence tests | T03 | M |
| P2-T05 | [task-05-auth-screens.md](task-05-auth-screens.md) | 2.3a — S-02, S-15 (auth + admin invites), offline hint | T02, T04 | M |
| P2-T06 | [task-06-sync-engine.md](task-06-sync-engine.md) | 2.3b — sync engine, LWW merge, sync indicator | T05 | L |
| P2-T07 | [task-07-first-signin-signout.md](task-07-first-signin-signout.md) | 2.3c — S-03, sign-out wipe, two-context E2E | T06 | M |
| P2-T08 | [task-08-deploy-artifacts.md](task-08-deploy-artifacts.md) | 2.4a — `deploy/` files, `just release`, `just deploy` | T07 | M |
| P2-T09 | [task-09-vps-provisioning.md](task-09-vps-provisioning.md) | 2.4b — provision VPS, restore drill, uptime check (manual, guided) | T08 | M |
| P2-T10 | [task-10-phase-acceptance.md](task-10-phase-acceptance.md) | Phase 2 acceptance | T01–T09 | M |

## Execution notes

**Why the splits:**

- **2.1 → T01 + T02.** 2.1 has 8 checkboxes and introduces most new Rust concepts at once (custom extractor,
  cookies, hashing, background task, middleware). T01 builds the session machinery that everything else needs;
  T02 adds registration, admin, cross-cutting security middleware and the full auth integration test suite.
- **2.2 → T03 + T04.** Push (validation, ownership, LWW, dependency order) is the most error-prone server code in
  the project and deserves its own session. Pull, export/restore and the two-device convergence tests build on it.
- **2.3 → T05 + T06 + T07.** 2.3 has 7 client checkboxes spanning auth UI, the sync engine and destructive flows.
  T05 = screens against the generated client; T06 = the engine (pure merge logic + triggers); T07 = first
  sign-in, sign-out wipe and the end-to-end proof.
- **2.4 → T08 + T09.** T08 is code in the repo (verifiable locally); T09 is manual work on the VPS that the
  executor guides the owner through.

**Ordering rationale:** server API first (T01–T04, each ending with `just gen-api`), then client (T05–T07), then
deployment (T08–T09). The client never calls an endpoint that does not exist yet.

**Easy to get wrong:**

- `server_seq` must be allocated inside the same transaction as the row write, from `sync_seq` (single row
  `id = 1`), never from client data.
- Every query touching user data filters by `user_id` from `CurrentUser` — including ownership lookups of parent
  rows (deck of a card, card of a state/log).
- LWW comparison is `(updated_at, updated_by)`: larger `updated_at` wins; tie → lexicographically larger
  `updated_by`. The same function must exist on server (Rust) and client (TS) — test both with the same cases.
- `review_log` is append-only and idempotent by `id`; only `deleted_at` may change.
- `review_log.practice` (decision D2) must be carried end-to-end: Dexie → push → SQLite → pull.
- Session cookie `ac_session` is `HttpOnly; Secure; SameSite=Strict; Path=/`. In dev over plain HTTP via the Vite
  proxy, `Secure` cookies on `localhost` work in Chromium and WebKit; do not add an insecure mode without asking.
- Server returns error codes only; every new code needs `errors.<code>` keys in `en.json` and `ru.json`.
- Sign-out wipes IndexedDB and Cache Storage — guard it with the unsynced-changes warning and cover it with E2E.

## Phase acceptance

From `docs/plan.md`:

> Owner and one invited user each use the app on two devices; offline edits on both converge after reconnect; a
> VPS restart and a restore drill lose no data.

Added criteria:

- `just lint`, `just test`, `just e2e` (WebKit) are green; CI is green on `main`.
- `/api/health` is monitored by the uptime check.
- `deploy/README.md` documents deploy, rollback, backup verification and restore.
