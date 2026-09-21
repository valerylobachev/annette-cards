# P0-T03 — Server skeleton

## Context

P0-T01 created the repository, `justfile` and CI; P0-T02 created the React PWA shell in `web/` with the Vite
proxy to `127.0.0.1:8080`. `server/` is empty. This task creates the Rust backend skeleton: CLI, config,
logging, error type, SQLite pool with migrations, health/meta endpoints, OpenAPI export feeding the orval
client, and embedded PWA serving. This is the owner's **first Rust code** in the project — keep it idiomatic
but approachable (CLAUDE.md → Rust conventions).

## Read first

- `CLAUDE.md` (always) — Rust conventions, Commands, Architectural invariants
- `docs/architecture.md` §5.1 (modules), §5.2 (request pipeline), §5.3 (API: `/api/health`, `/api/meta`,
  `/api/openapi.json`, error response), §10 (configuration), §12 (migrations on startup), §13 (observability)
- `docs/tech_stack.md` → Server: tokio, axum, tower-http, sqlx, serde, utoipa + utoipa-axum, thiserror, anyhow,
  tracing + tracing-subscriber, figment, clap, rust-embed, uuid; Database (pragmas)
- `dev/impl/00-overview.md` — decision D8

## Scope

From `docs/plan.md` (Phase 0 · Server skeleton):

- [ ] Cargo project (edition 2024), crates from `tech_stack.md`
- [ ] `clap` CLI with `serve` and `openapi` subcommands
- [ ] `figment` config, `tracing` setup, `AppState`, `AppError` with `IntoResponse`
- [ ] SQLite pool with pragmas (WAL, foreign keys, busy timeout), migrations on startup, empty initial migration
- [ ] `GET /api/health` and `GET /api/meta`; router test with `oneshot`
- [ ] `utoipa` OpenAPI; `just gen-api` produces `web/openapi.json` and the orval client
- [ ] `rust-embed` serving of `web/dist` with SPA fallback and cache headers

Added:

- [ ] `server/.env.example` with every base variable from `architecture.md` §10 (D8) `(added)`
- [ ] tower-http `TraceLayer`, `CompressionLayer`, `TimeoutLayer` (30 s) per §5.2; CORS only in dev `(added)`
- [ ] `GET /api/openapi.json` serving the same spec as the CLI `(added)`

## Out of scope

- Auth, sessions, users, `create-user`/`invite`/`purge` subcommands (P2-T01, P2-T02, P4-T07).
- Origin check, rate limiting, security headers, JSON logs with request id (P2-T02).
- Any user-data tables (P2-T01, P2-T03). The initial migration is empty.
- Feature flags other than all `false` in `/api/meta` (each feature task flips its own flag).

## Implementation steps

1. `cargo new --bin` in `server/` (package `annette-cards`, `edition = "2024"`); remove `server/.gitkeep`.
   Add crates: `tokio` (full), `axum`, `tower`, `tower-http` (trace, compression-gzip/zstd, timeout, cors),
   `sqlx` (runtime-tokio, sqlite, macros, migrate), `serde`, `serde_json`, `utoipa` (axum_extras),
   `utoipa-axum`, `thiserror`, `anyhow`, `tracing`, `tracing-subscriber` (env-filter, json), `figment` (env,
   toml), `clap` (derive), `rust-embed`, `mime_guess`, `uuid` (v7). Dev: `http-body-util`.
   Create module files from CLAUDE.md: `main.rs`, `app.rs`, `config.rs`, `error.rs`, `db.rs`,
   `static_files.rs`, and an `api/health.rs` (or `meta.rs`) for the two endpoints.
   → verify: `cargo build` succeeds; `Cargo.lock` is tracked by git.
2. `main.rs`: `#[tokio::main] async fn main() -> anyhow::Result<()>`; `clap` derive enum
   `Command { Serve, Openapi }`. `serve` loads config, inits tracing, creates the pool, runs migrations, builds
   the router and binds `config.bind`. `openapi` prints the spec JSON to stdout (no DB, no logging to stdout).
   → verify: `cargo run -- --help` lists both subcommands.
3. `config.rs`: `struct Config { bind: SocketAddr, database_url: String, public_url: Option<String>,
   session_ttl_days: u32 }` loaded with figment from `Env::prefixed("ANNETTE_")` (plus optional
   `annette.toml`), defaults from §10 (`127.0.0.1:8080`, `sqlite://data/annette.db`, `90`). `RUST_LOG`
   (default `info`) drives `tracing_subscriber::EnvFilter`; pretty output in debug builds, JSON in release.
   Create `server/.env.example` `(added)` listing all §10 variables with defaults/comments (later tasks fill
   in the optional ones); `justfile` recipes load `server/.env`.
   → verify: `ANNETTE_BIND=127.0.0.1:9090 cargo run -- serve` listens on 9090.
4. `error.rs`: `#[derive(thiserror::Error)] enum AppError { NotFound, BadRequest(String code),
   Internal(#[from] anyhow::Error / sqlx::Error) … }` implementing `IntoResponse` →
   `{ "code": "not_found", "details": null }` with the right status. Codes are stable snake_case strings,
   never user-facing text. Internal errors log the cause and return `internal_error`.
   → verify: unit test turns `AppError::NotFound` into status 404 and the JSON body above.
5. `db.rs`: `SqliteConnectOptions::from_str(url)?.create_if_missing(true).journal_mode(Wal)
   .foreign_keys(true).busy_timeout(5s).synchronous(Normal)`; `SqlitePool` with a small max connection count;
   `sqlx::migrate!("./migrations").run(&pool)` on startup (a failed migration aborts startup, §12). Create the
   first migration with `just db-new init` containing only a comment. Create `server/data/` on demand.
   → verify: `just db-migrate` creates the DB; `cargo run -- serve` logs "migrations applied".
6. `app.rs`: `pub struct AppState { pub pool: SqlitePool, pub config: Arc<Config> }` shared as
   `Arc<AppState>` (or `#[derive(Clone)]` with inner `Arc`s — choose one and keep it). `fn router(state)`:
   `/api` routes, then static files fallback. Layers: `TraceLayer`, `CompressionLayer`,
   `TimeoutLayer::new(30s)`, and `CorsLayer` only in debug builds `(added)`.
   → verify: requests show up in logs with method, path, status, latency.
7. Endpoints: `GET /api/health` → pings DB (`SELECT 1`) → `200 {"status":"ok"}` or `503`;
   `GET /api/meta` → `{ "version": env!("CARGO_PKG_VERSION"), "features": { "tts": false, "commons": false,
   "enrich": false, "push": false } }`. DTOs derive `Serialize`, `Deserialize`, `utoipa::ToSchema`; handlers
   annotated with `#[utoipa::path]`. Handlers stay thin.
   → verify: `curl 127.0.0.1:8080/api/health` returns OK.
8. OpenAPI: assemble with `utoipa-axum` `OpenApiRouter` (or `#[derive(OpenApi)]`). `openapi` subcommand prints
   it; `GET /api/openapi.json` `(added)` serves it. In `web/`, `orval.config.ts` generates a fetch/TanStack
   Query client into `src/api/` from `openapi.json`. Run `just gen-api`.
   → verify: `web/openapi.json` and `web/src/api/*` exist; running `just gen-api` twice gives no git diff.
9. `static_files.rs`: `#[derive(RustEmbed)] #[folder = "../web/dist"]`. Handler: exact file → bytes with
   `mime_guess` content type; hashed assets (`/assets/*`) get `Cache-Control: public, max-age=31536000,
   immutable`; `index.html`, `sw.js`, `manifest.webmanifest` get `no-cache`; unknown non-`/api` path → SPA
   fallback to `index.html`; unknown `/api/*` → JSON 404 via `AppError`. Handle missing `web/dist` in dev/CI
   (placeholder `web/dist/.gitkeep` kept out of the build, or `mkdir -p web/dist` in the `just` recipes and CI —
   pick one, keep CI consistent with P0-T01).
   → verify: `just build` then run the release binary: `http://127.0.0.1:8080/` shows the app shell,
   `/decks` (deep link) loads, `/api/nope` returns JSON 404.
10. Add `server/bacon.toml` with a `run` job used by `just dev-server`. Run `just sqlx-prepare` (commits an
    empty/initial `.sqlx/` if no queries yet).
    → verify: `just dev` runs both sides; the Vite app at :5173 can fetch `/api/meta` through the proxy.

## Tests

- Router tests with `tower::ServiceExt::oneshot` (in `app.rs` tests or `server/tests/`):
  `GET /api/health` → 200; `GET /api/meta` → 200 with `version` and all features `false`;
  `GET /api/unknown` → 404 `{"code":"not_found"}`; `GET /decks` → `index.html` (SPA fallback, requires a test
  build of `web/dist` or an embed stub); `GET /assets/x.js` has the immutable cache header.
- `#[sqlx::test]` smoke test: migrations apply and `PRAGMA foreign_keys` returns 1.
- `AppError` → response unit test.

## Invariants to respect

- No user-visible strings from the server — only error codes.
- Timestamps are `i64` ms since epoch (none yet, but DTO conventions start here).
- Secrets only on the server; `.env` never committed.
- `cargo clippy -- -D warnings` clean; handlers thin (extract → service → DTO).

## Rust learning notes (server tasks only)

This task introduces most foundational concepts for the first time. Explain each briefly in the final task
summary (not in long code comments):

- `async fn main` with `#[tokio::main]`; what the tokio runtime does.
- `anyhow::Result` in `main`/startup vs `thiserror` enums for domain errors; the `?` operator and `#[from]`.
- `impl IntoResponse for AppError` — traits as the way axum turns values into HTTP responses.
- `Arc<AppState>` and `State<…>` extractor — shared ownership across concurrent requests; what an extractor is.
- `clap` derive macros and `figment` layered config.
- `SqlitePool`, `sqlx::migrate!` (compile-time embedding), SQLite pragmas.
- `#[derive(Serialize, ToSchema)]` and `#[utoipa::path]` — derive macros generating code.
- `rust-embed` — files embedded at compile time; why the web must be built first.
- tower layers (`TraceLayer`, `TimeoutLayer`) as middleware.

## Docs to update

- `docs/architecture.md` §10 → mention `server/.env.example`; §5.3 already lists `/api/openapi.json`.
- `docs/tech_stack.md` → any extra crate (`mime_guess`, `http-body-util`) with a one-line reason.
- `CLAUDE.md` → Commands table note that recipes load `server/.env`; how `web/dist` is handled for
  `cargo check` (step 9 choice).
- `README.md` → Getting started: verify `cp server/.env.example server/.env`, `just db-migrate`, `just dev` work
  as written (the `create-user` line stays; it becomes valid in P2-T01).
- `docs/plan.md` → tick the seven Server skeleton checkboxes and the three `(added)` checkboxes.

## Definition of done

- [ ] All scope items implemented
- [ ] Tests written and passing: `just test`
- [ ] `just lint` clean
- [ ] `just build` produces one binary that serves the PWA and `/api/health`
- [ ] Docs updated as listed above; plan.md checkboxes ticked
- [ ] Committed: `feat(server): add axum skeleton with config, SQLite, OpenAPI and embedded PWA`

## If unclear

If anything in this task is ambiguous or conflicts with the docs, stop and ask before implementing.
