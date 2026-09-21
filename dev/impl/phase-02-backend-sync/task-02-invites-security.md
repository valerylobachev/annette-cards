# P2-T02 — Invites and security

## Context

P2-T01 added `users`, `invites`, `sessions`, login/logout, the `CurrentUser`/`AdminUser` extractors and the CLI
(`create-user`, `invite`). This task completes invite-only registration, the admin invite API used by S-15,
cross-cutting request security (Origin check, rate limiting, security headers) and production logging, and
closes 2.1 with integration tests for all auth flows.

## Read first

- `CLAUDE.md` (always)
- `docs/architecture.md` §5.2 (request pipeline), §5.3 (`/api/auth/register`, `/api/admin/invites`), §5.4
  (`invites`), §9 (CSRF, Registration, Headers, login rate limit), §10 (`ANNETTE_PUBLIC_URL`, `RUST_LOG`), §13
- `docs/use_cases.md` UC-02, UC-03 (rate limit alternative), UC-28
- `docs/ui_ux.md` S-02 error codes, S-15 Invites
- `docs/tech_stack.md` → `tower_governor`, `tower-http`, `tracing-subscriber` (JSON in prod)

## Scope

From `docs/plan.md` §2.1 Auth (server):

- [ ] Register with invite (validation, single use, expiry)
- [ ] Admin invite endpoints (list/create/revoke), admin-only guard
- [ ] Origin check middleware, login rate limiting (`tower_governor`), security headers
- [ ] Integration tests for all auth flows
- [ ] (added) JSON logs in production, request id and hashed user id in request spans (architecture §13)

## Out of scope

- Client registration and invite UI → P2-T05.
- Rate limits for audio (P3-T01) and enrich (P3-T04) — but design the limiter so they can reuse it.
- HSTS — set by Caddy in P2-T08.

## Implementation steps

1. **Register.** `POST /api/auth/register` `{invite_code, display_name, email, password}` in one sqlx transaction:
   load invite by `code`; missing or already used (`used_by IS NOT NULL`) → 400 `invite_invalid`;
   `expires_at < now` → 400 `invite_expired`; email exists → 409 `email_taken`; password < 10 → 400
   `password_too_short`; empty/too long display name (> 100) → 400 `validation_failed`. Insert user (UUIDv7),
   set `used_by`, `used_at`, create a session, return `MeResponse` + `ac_session` cookie (same as login).
   → verify: register with a CLI-created invite via `curl`, then `GET /api/auth/me`.
2. **Admin module** `server/src/admin/` (SQL in `admin/invites.rs`), all handlers take `AdminUser`:
   - `GET /api/admin/invites` → list `{code, note, created_at?, expires_at, used_by_email?, used_at, status}` where
     `status ∈ {active, used, expired}` computed on the server (add `created_at` column only if you need it — if so,
     add a migration via `just db-new` and update §5.4);
   - `POST /api/admin/invites` `{note?, days? (default 7, 1..=90)}` → created invite (reuse the code generator from
     T01's CLI — move it into `admin/` so both call one function);
   - `DELETE /api/admin/invites/{code}` → 204; only unused invites can be revoked (used → 409 `invite_used`).
     Revoke = delete the row (invites are not a synced entity).
   Non-admin → 403 `forbidden`.
   → verify: router tests below.
3. **Origin check middleware** (`server/src/app.rs` or `server/src/security.rs`): for non-GET/HEAD/OPTIONS under
   `/api`, require `Origin` equal to `ANNETTE_PUBLIC_URL`; also allow `http://localhost:5173` and
   `http://127.0.0.1:5173` when a `dev` config flag is set. Missing or mismatched → 403 `origin_mismatch`.
   Implement with `axum::middleware::from_fn_with_state`.
   → verify: `curl -X POST` without Origin → 403.
4. **Rate limiting.** `tower_governor` on `/api/auth/login` and `/api/auth/register`: 10 requests/min per IP
   (behind Caddy use `X-Forwarded-For` via `SmartIpKeyExtractor`). Over limit → 429 with body
   `{ "code": "rate_limited", "details": null }` (map governor errors into `AppError`).
   → verify: router test issuing 11 requests.
5. **Security headers** via `tower_http::set_header::SetResponseHeaderLayer` on all responses:
   `Content-Security-Policy: default-src 'self'` (extend minimally for what the PWA actually needs, e.g.
   `img-src 'self' data:`; document the final value), `X-Content-Type-Options: nosniff`,
   `Referrer-Policy: same-origin`. Verify the PWA still loads in `just build` output.
   → verify: `curl -I http://127.0.0.1:8080/` shows headers; the app shell renders in Chromium and WebKit.
6. **Pipeline order** matches §5.2: Trace → Compression → Timeout (30 s) → origin check → rate limiter (route) →
   handler. Keep the assembly readable in `app.rs` with a comment-free, well-named function per layer group.
7. **Logging (added).** `tracing-subscriber` with `.json()` when `ANNETTE_LOG_FORMAT=json` (default `pretty` in
   dev; add the variable to config, `.env.example` and §10). Add `tower_http::request_id` (`x-request-id`, UUIDv7)
   and include `request_id`, `status`, `latency_ms` in the `TraceLayer` span. In `CurrentUser` extraction record
   `user = <first 12 hex chars of sha256(user_id)>` into the current span (never raw email/user id).
   → verify: run with JSON format, make a request, log line contains `request_id` and hashed `user`.
8. `just sqlx-prepare` and `just gen-api`. → verify: `web/src/api/` contains register and admin invite functions.

## Tests

Router tests with `oneshot` (use a helper that creates app + test DB + admin user):

- register: valid invite → 200 + cookie, invite marked used; reuse same code → `invite_invalid`; expired →
  `invite_expired`; unknown → `invite_invalid`; existing email (different case) → `email_taken`; short password →
  `password_too_short`; transaction rollback leaves invite unused when user insert fails.
- admin: list/create/revoke as admin; non-admin → 403 `forbidden`; anonymous → 401; revoke used → 409 `invite_used`;
  status computation (`active`/`used`/`expired`).
- origin: POST with correct Origin passes; wrong/missing → 403 `origin_mismatch`; GET without Origin passes.
- rate limit: 11th login in a minute → 429 `rate_limited`.
- headers: CSP, `X-Content-Type-Options`, `Referrer-Policy` present on `/api/health` and `/`.
- Full flow test: CLI-service creates admin → admin creates invite → register → me → logout-others → password
  change → logout.

## Invariants to respect

- Stable error codes only; each new code (`invite_invalid`, `invite_expired`, `email_taken`, `invite_used`,
  `origin_mismatch`, `rate_limited`, `validation_failed`) documented for the client (P2-T05 adds translations).
- Admin endpoints guarded server-side, never only in the UI.
- Logs never contain passwords, tokens, emails or raw user ids.

## Rust learning notes (server tasks only)

- **Tower middleware and layers** — `from_fn_with_state`, layer ordering (outermost first), `ServiceBuilder`.
- **Transactions with sqlx** — `pool.begin()`, `&mut *tx` as executor, commit/rollback on drop.
- **Wrapper extractors** — `AdminUser` built on top of `CurrentUser`.
- **Mapping third-party errors** into `AppError` with `From` impls.

## Docs to update

- `docs/architecture.md` §5.2 (final layer order, request id), §5.3 (register/admin DTOs and error codes), §9 (final
  CSP value), §10 (`ANNETTE_LOG_FORMAT`, dev origin flag), §13 (hashed user id format); §5.4 if `invites.created_at`
  was added.
- `server/.env.example`: new variables.
- `docs/plan.md`: tick the four checkboxes; add and tick the `(added)` logging checkbox.

## Definition of done

- [ ] All scope items implemented
- [ ] Tests written and passing: `just test`
- [ ] `just lint` clean
- [ ] `.sqlx/` refreshed, `just gen-api` run
- [ ] Docs updated as listed above; plan.md checkboxes ticked
- [ ] Committed: `feat(server): add invite registration, admin invites and request security`

## If unclear

If anything in this task is ambiguous or conflicts with the docs, stop and ask before implementing.
