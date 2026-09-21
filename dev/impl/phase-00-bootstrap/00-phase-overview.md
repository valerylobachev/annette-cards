# Phase 0 — Bootstrap

**Goal:** a working monorepo skeleton with all tooling, so that later tasks only add features.
**Use cases:** — (infrastructure only; UC-27 language switch is prepared by the i18n setup)
**Screens:** placeholders for S-01…S-16 routes and the bottom tab bar layout (`ui_ux.md` §3)
**Prerequisites:** a MacBook with Rust (stable, edition 2024), Node.js LTS, `pnpm`, `just`, `bacon`,
`sqlx-cli` (`cargo install sqlx-cli --no-default-features --features sqlite`); a GitHub repository with Actions
enabled. `zig` + `cargo-zigbuild` are only needed from Phase 2 (`just release`).

## Tasks

| # | File | Scope (plan.md section) | Depends on | Est. size |
| --- | --- | --- | --- | --- |
| P0-T01 | [task-01-repo-tooling.md](task-01-repo-tooling.md) | Phase 0 · Repository and tooling | — | S |
| P0-T02 | [task-02-web-skeleton.md](task-02-web-skeleton.md) | Phase 0 · Web skeleton | P0-T01 | L |
| P0-T03 | [task-03-server-skeleton.md](task-03-server-skeleton.md) | Phase 0 · Server skeleton | P0-T01, P0-T02 | L |
| P0-T04 | [task-04-phase-acceptance.md](task-04-phase-acceptance.md) | Phase 0 · Acceptance | P0-T01…T03 | S |

## Execution notes

- **Order.** Repository and tooling come first so that every later task has `just` recipes, `.gitignore` and
  CI. The web skeleton comes before the server skeleton because two server items depend on web output:
  `just gen-api` runs `pnpm orval` inside `web/`, and `rust-embed` embeds `web/dist`.
- **CI before the code exists.** P0-T01 writes the GitHub Actions workflow and the full `justfile`, but most
  recipes call into `web/` and `server/`, which do not exist yet. P0-T01 is verified with `just --list` and a
  YAML syntax check; the green CI run and full `just lint` / `just test` are verified in P0-T04.
- **No subsections were split.** Phase 0 has no numbered subsections; each `###` heading is one task.
- **Easy to get wrong:**
  - `.gitignore` currently ignores `Cargo.lock` (decision D1): the server is a binary, so the lock file must be
    committed.
  - `.sqlx/` offline metadata must be committed and CI must build with `SQLX_OFFLINE=true`.
  - `rust-embed` needs `web/dist` to exist at compile time; `just build` must build the web first, and
    `cargo check` in dev must not fail when `web/dist` is missing (use a `debug-embed`-less dev mode or create an
    empty `web/dist/.gitkeep` placeholder — pick one and document it).
  - The Vite dev proxy targets `127.0.0.1:8080` (not `localhost`, which may resolve to IPv6 on macOS).
  - `/api/*` must be excluded from the service-worker navigation fallback, otherwise API calls get `index.html`.
  - Inputs must use a font size of at least 16 px to avoid iOS zoom — set it in the base CSS now.
- **Added items** (from the coverage analysis, marked `(added)` in task scopes): `just dev-https` recipe and the
  `.gitignore` fix in P0-T01; `server/.env.example`, tower-http trace/compression/timeout layers and
  `GET /api/openapi.json` in P0-T03.

## Phase acceptance

From `docs/plan.md`:

> **Acceptance:** `just dev` shows the app shell with tabs in RU/EN; `/api/health` returns OK; CI passes;
> `just build` produces one binary that serves the PWA.

Added criteria:

- `just lint` and `just test` pass locally on a clean checkout.
- `just gen-api` regenerates `web/openapi.json` and `web/src/api/` with no diff on a second run.
- `cargo run -- serve` with `server/.env.example` copied to `server/.env` starts without extra configuration.
