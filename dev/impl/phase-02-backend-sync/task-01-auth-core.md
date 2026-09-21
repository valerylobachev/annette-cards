# P2-T01 — Auth core

## Context

Phase 1 delivered a fully local PWA; the Rust server from Phase 0 only serves `/api/health`, `/api/meta`, the
OpenAPI spec and the embedded PWA. This task gives the server real users and sessions: the tables, the CLI to
bootstrap the first admin account, password hashing, login/logout and a `CurrentUser` extractor. Every later
server feature (sync, audio, enrich, push) depends on `CurrentUser`.

## Read first

- `CLAUDE.md` (always) — especially Rust conventions and "No user-visible strings from the server"
- `docs/architecture.md` §5.1 (`auth/`, `main.rs`), §5.3 (auth endpoints), §5.4 (`users`, `invites`, `sessions`),
  §9 (Passwords, Sessions, CSRF), §10 (`ANNETTE_SESSION_TTL_DAYS`, `ANNETTE_PUBLIC_URL`), §11 (Session cleanup)
- `docs/use_cases.md` UC-03, UC-28 (CLI invite), UC-29 (bootstrap)
- `docs/tech_stack.md` → `argon2`, `rand`, `sha2`, `axum-extra` cookies, `clap`, "Why sessions instead of JWT"

## Scope

From `docs/plan.md` §2.1 Auth (server):

- [ ] Migrations: `users`, `invites`, `sessions`
- [ ] CLI `create-user` (with `--admin`) and `invite` subcommands
- [ ] Argon2id hashing; login, logout, logout-others, me, change password
- [ ] Session cookie, `CurrentUser` extractor, sliding expiry, hourly cleanup task

## Out of scope

- `POST /api/auth/register`, admin invite endpoints, origin check, rate limiting, security headers, JSON logging
  → P2-T02.
- Any sync tables → P2-T03.
- Client screens → P2-T05.

## Implementation steps

1. **Migration.** `just db-new auth` → create `users`, `invites`, `sessions` exactly as in architecture §5.4
   (`email ... UNIQUE COLLATE NOCASE`, `sessions.token_hash` is the PK, `ON DELETE CASCADE` on `sessions.user_id`).
   → verify: `just db-migrate` succeeds; `sqlite3 data/annette.db .schema` shows the three tables.
2. **Module layout.** `server/src/auth/mod.rs` with submodules `password.rs`, `session.rs`, `users.rs` (SQL owned
   here), `handlers.rs`, `extractor.rs`, `dto.rs`. Keep handlers thin: extract → service → DTO.
   → verify: `cargo check`.
3. **Password hashing** (`password.rs`): `hash_password(&str) -> Result<String, AppError>` and
   `verify_password(&str, &str) -> Result<bool, AppError>` using Argon2id with default params. Enforce min length
   10 → error code `password_too_short`. Run hashing in `tokio::task::spawn_blocking` (CPU-bound).
   → verify: unit tests pass.
4. **Sessions** (`session.rs`): token = 32 random bytes (`rand`), cookie value = base64url; DB stores
   `token_hash = hex(sha256(value))`. Functions: `create_session(pool, user_id, device_label) -> (token, expires_at)`,
   `find_user_by_token(pool, token) -> Option<(User, Session)>`, `touch(pool, token_hash)` (sliding: sets
   `last_seen_at = now`, `expires_at = now + ANNETTE_SESSION_TTL_DAYS`, only if last touch > 1 h ago to avoid a write
   per request), `revoke(pool, token_hash)`, `revoke_others(pool, user_id, keep_hash)`,
   `delete_expired(pool, now) -> u64`. All timestamps `i64` ms.
   → verify: `#[sqlx::test]` tests below.
5. **Cookie.** Name `ac_session`, attributes `HttpOnly; Secure; SameSite=Strict; Path=/`, `Max-Age` = TTL. Use
   `axum_extra::extract::CookieJar`. Logout clears the cookie (expired `Max-Age=0`).
6. **`CurrentUser` extractor** (`extractor.rs`): implement `FromRequestParts<Arc<AppState>>` (or the state type
   used in Phase 0). Reads `ac_session`, looks up the session, rejects missing/expired with `AppError::Unauthorized`
   → HTTP 401 `{ "code": "unauthorized", "details": null }`. Exposes `user_id`, `email`, `display_name`,
   `is_admin`, `session_hash`. Add `AdminUser` wrapper that returns 403 `forbidden` when `!is_admin` (used in T02).
   → verify: router test with and without cookie.
7. **Endpoints** (register in `app.rs` under `/api/auth`, with utoipa annotations and `ToSchema` DTOs):
   - `POST /api/auth/login` `{email, password, device_label?}` → 200 `MeResponse` + `Set-Cookie`; wrong email or
     password → 401 `invalid_credentials` (same code for both; verify a dummy hash when the email is unknown to keep
     timing similar).
   - `POST /api/auth/logout` → 204, revokes current session, clears cookie.
   - `POST /api/auth/logout-others` → 204, revokes all other sessions of the user.
   - `GET /api/auth/me` → `MeResponse {id, email, display_name, is_admin, created_at}`.
   - `POST /api/auth/password` `{current_password, new_password}` → 204; wrong current → 400 `invalid_credentials`;
     short new → 400 `password_too_short`; revoke all other sessions on success.
   → verify: `curl` against `just dev-server` after creating a user.
8. **CLI** (`main.rs`, clap derive): `create-user --email <e> [--name <n>] [--admin]` prompts for the password twice
   (use `rpassword` only if needed — prefer reading from stdin or `--password-stdin` to avoid a new dependency;
   mention any new crate in `tech_stack.md`). `invite [--note <text>] [--days 7]` creates a 12-char random code in
   `invites` with `created_by` = first admin (or `--by <email>`), prints the code and the link
   `{ANNETTE_PUBLIC_URL}/register?invite=CODE`. CLI uses `anyhow`.
   → verify: `cargo run -- create-user --email you@example.com --admin` then `cargo run -- invite --note Anna`.
9. **Cleanup task.** In `serve`, `tokio::spawn` a loop with `tokio::time::interval(Duration::from_secs(3600))`
   calling `delete_expired`; log the count with `tracing::info!`.
   → verify: log line appears at startup tick.
10. **Config.** Add `session_ttl_days` (default 90) and `public_url` to the figment config; add
    `ANNETTE_SESSION_TTL_DAYS` and `ANNETTE_PUBLIC_URL` to `server/.env.example`.
11. `just sqlx-prepare`, then `just gen-api` so `web/openapi.json` and `web/src/api/` include the auth endpoints.
    → verify: `git status` shows updated `.sqlx/` and `web/src/api/`; `pnpm tsc --noEmit` passes.

## Tests

- Unit: `hash_password`/`verify_password` roundtrip; wrong password → false; 9-char password → `password_too_short`.
- `#[sqlx::test]`: create session → `find_user_by_token` returns user; expired session → `None`; `touch` extends
  `expires_at`; `revoke_others` keeps only the current; `delete_expired` removes only expired rows.
- Router (`tower::ServiceExt::oneshot`) with an in-memory/test DB:
  - login success sets `ac_session` with `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/`;
  - login wrong password and unknown email both → 401 `invalid_credentials`;
  - email match is case-insensitive;
  - `GET /api/auth/me` without cookie → 401 `unauthorized`; with cookie → 200;
  - logout → subsequent `me` → 401;
  - logout-others: two sessions, call from A, B is revoked, A still valid;
  - password change: wrong current → 400; success → other sessions revoked, login with new password works.
- CLI: test the service functions used by `create-user`/`invite` (not the prompt I/O).

## Invariants to respect

- Server returns stable error codes only (`invalid_credentials`, `unauthorized`, `forbidden`,
  `password_too_short`); no user-visible strings.
- Secrets never leave the server; the session token is never readable by JS (`HttpOnly`).
- Every query touching user data filters by `user_id` from the authenticated session.
- Timestamps are `i64` ms since epoch; IDs are UUIDv7 (`users.id`).

## Rust learning notes (server tasks only)

Explain briefly in the final task summary:

- **Custom extractors** — implementing `FromRequestParts` for `CurrentUser`, and how `Rejection` maps to `AppError`.
- **`spawn_blocking`** — why CPU-heavy Argon2 must not run on the async executor.
- **Background tasks** — `tokio::spawn` + `tokio::time::interval`, and cloning the pool into the task.
- **Cookies with `axum-extra`** — returning `(CookieJar, Json<T>)` tuples from handlers (`IntoResponse` for tuples).
- **`Option`/`?` in SQL lookups** — `fetch_optional` returning `Option<Row>`.

## Docs to update

- `docs/architecture.md` §5.3: document request/response DTO shapes if they differ from the table; list auth error
  codes (`invalid_credentials`, `unauthorized`, `forbidden`, `password_too_short`).
- `docs/tech_stack.md`: any new crate (e.g. `base64`, `hex`, `rpassword`) with a one-line reason.
- `CLAUDE.md` Commands / `README.md` Getting started: confirm the exact `create-user` and `invite` invocation.
- `server/.env.example`: new variables.
- `docs/plan.md`: tick the four checkboxes above.

## Definition of done

- [ ] All scope items implemented
- [ ] Tests written and passing: `just test`
- [ ] `just lint` clean (clippy `-D warnings`, fmt, biome, tsc)
- [ ] `.sqlx/` refreshed, `just gen-api` run, generated client committed
- [ ] Docs updated as listed above; plan.md checkboxes ticked
- [ ] Committed: `feat(server): add users, sessions and login/logout with CLI bootstrap`

## If unclear

If anything in this task is ambiguous or conflicts with the docs, stop and ask before implementing.
