# P0-T01 — Repository and tooling

## Context

The repository currently contains only documentation (`docs/`, `README.md`, `CLAUDE.md`, `dev/`) and a
`.gitignore` built from GitHub templates. No code exists yet. This task creates the monorepo skeleton,
the `justfile` that every later task relies on, and the CI workflow. The next two tasks (P0-T02 web skeleton,
P0-T03 server skeleton) fill `web/` and `server/`; until then most recipes have nothing to run against.

## Read first

- `CLAUDE.md` (always) — Repository layout, Commands table, Workflow
- `docs/plan.md` — Phase 0 · Repository and tooling
- `docs/tech_stack.md` — Infrastructure (CI, `cargo-zigbuild`), Developer tooling (`just`, `bacon`, `sqlx-cli`)
- `README.md` — Getting started (mentions `just db-migrate`, `just dev-https`, `server/.env.example`)
- `dev/impl/00-overview.md` — decisions D1 and D8

## Scope

From `docs/plan.md` (Phase 0 · Repository and tooling):

- [ ] Create repo structure (`web/`, `server/`, `deploy/`, `docs/`), `.gitignore`, `.editorconfig`
- [ ] `justfile` with recipes: `dev`, `dev-web`, `dev-server`, `test`, `e2e`, `lint`, `fmt`, `gen-api`,
      `db-new`, `db-migrate`, `sqlx-prepare`, `build`, `release`, `deploy`
- [ ] GitHub Actions: lint + test for web and server on push; build release binary on tag

Added:

- [ ] Remove `Cargo.lock` from `.gitignore` so the lock file of the binary crate is committed (D1) `(added)`
- [ ] `just dev-https` recipe for testing on an iPhone over HTTPS (D8) `(added)`

## Out of scope

- Creating the Vite/React app (P0-T02) or the Cargo project (P0-T03).
- Implementing `release` and `deploy` for real — write them now as documented recipes (P2-T08 finalizes them,
  including `deploy/` files).
- Any `deploy/` content besides a `.gitkeep` (P2-T08).

## Implementation steps

1. Create directories `web/`, `server/`, `deploy/` with a `.gitkeep` each (removed later when real files
   arrive). `docs/` already exists.
   → verify: `ls` shows the four directories.
2. Edit `.gitignore`:
   - remove the `Cargo.lock` line (D1);
   - keep `target/`; add `web/node_modules/`, `web/dist/`, `web/dev-dist/`, `web/playwright-report/`,
     `web/test-results/`, `server/data/`, `*.db`, `*.db-shm`, `*.db-wal`, `server/.env`, `.DS_Store`,
     `.idea/`, local HTTPS certificates (`*.pem` under `certs/`).
   - make sure `server/.sqlx/` and `web/src/api/` are **not** ignored (both are committed).
   → verify: `git check-ignore -v server/Cargo.lock` prints nothing; `git check-ignore server/.env` matches.
3. Add `.editorconfig`: UTF-8, LF, final newline, trim trailing whitespace; 2 spaces for
   TS/JSON/YAML/Markdown/CSS; 4 spaces for `*.rs` and `*.toml`; `max_line_length = 120` (docs use 120).
   → verify: file exists; existing docs are not reformatted.
4. Create `justfile` at the repo root with `set dotenv-load := false`, a default recipe that runs `just --list`,
   and one-line doc comments per recipe. Recipes (commands as in `CLAUDE.md` Commands table):
   - `dev` — run `dev-server` and `dev-web` together (e.g. `just dev-server & just dev-web; wait`, or a small
     `trap`-based script so Ctrl-C stops both);
   - `dev-web` — `cd web && pnpm dev`;
   - `dev-server` — `cd server && bacon run -- -- serve` (bacon job defined in `server/bacon.toml` in P0-T03);
   - `dev-https` `(added)` — `cd web && pnpm dev --host` with HTTPS enabled via an env flag
     (P0-T02 wires the flag to `@vitejs/plugin-basic-ssl` or a local `mkcert` certificate); document the iPhone
     steps in the recipe comment;
   - `test` — `cd server && cargo test` then `cd web && pnpm vitest run`;
   - `e2e` — `cd web && pnpm playwright test` (WebKit project mandatory);
   - `lint` — `cargo clippy --all-targets -- -D warnings`, `cargo fmt --check`, `pnpm biome check`,
     `pnpm tsc --noEmit`;
   - `fmt` — `cargo fmt` and `pnpm biome format --write` (or `biome check --write`);
   - `gen-api` — `cd server && cargo run -q -- openapi > ../web/openapi.json` then `cd web && pnpm orval`;
   - `db-new name` — `cd server && sqlx migrate add -r {{name}}` (reversible migrations);
   - `db-migrate` — `cd server && sqlx database create && sqlx migrate run` using `DATABASE_URL` from
     `server/.env` (`ANNETTE_DATABASE_URL`);
   - `sqlx-prepare` — `cd server && cargo sqlx prepare`;
   - `build` — `cd web && pnpm build` then `cd server && cargo build --release`;
   - `release` — `just build-web` style web build, then
     `cd server && cargo zigbuild --release --target x86_64-unknown-linux-musl`;
   - `deploy` — placeholder that prints "implemented in P2-T08" and exits non-zero.
   → verify: `just --list` shows all 15 recipes with descriptions.
5. Create `.github/workflows/ci.yml`:
   - trigger: `push` (all branches) and `pull_request`;
   - job `web`: checkout, `pnpm/action-setup`, `actions/setup-node` (LTS, pnpm cache), `pnpm install
     --frozen-lockfile`, `pnpm biome check`, `pnpm tsc --noEmit`, `pnpm vitest run`,
     `pnpm playwright install --with-deps webkit chromium`, `pnpm playwright test`;
   - job `server`: checkout, `dtolnay/rust-toolchain@stable` with clippy + rustfmt, `Swatinem/rust-cache`,
     env `SQLX_OFFLINE=true`, create `web/dist` (build web first, or `mkdir -p web/dist` placeholder — match the
     choice made in P0-T03), `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test`;
   - both jobs use `working-directory` defaults (`web` / `server`).
   → verify: `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/ci.yml'))"` succeeds.
6. Create `.github/workflows/release.yml`: on tags `v*`, build web (`pnpm build`), install `zig` and
   `cargo-zigbuild`, run `cargo zigbuild --release --target x86_64-unknown-linux-musl`, upload
   `annette-cards` as a GitHub release asset (`softprops/action-gh-release`).
   → verify: YAML parses as in step 5.

## Tests

No code tests in this task. Verification is structural: `just --list`, YAML parsing, `git check-ignore` checks.
The first real CI run happens after P0-T02/P0-T03 and is checked in P0-T04.

## Invariants to respect

- `server/.sqlx/` and `web/src/api/` are committed, never ignored (CLAUDE.md: sqlx offline metadata, generated
  client).
- Secrets never enter the repository: `server/.env` is ignored; only `server/.env.example` is committed (P0-T03).

## Docs to update

- `CLAUDE.md` → Commands table: add `just db-migrate` ("create DB and apply migrations") and `just dev-https`
  ("Vite over HTTPS for testing on iPhone"); add `.github/` and `.editorconfig` to the Repository layout tree.
- `README.md` → Getting started: make sure `just dev-https` matches the implemented recipe.
- `docs/plan.md` → tick the three Repository and tooling checkboxes and the two `(added)` checkboxes.

## Definition of done

- [ ] All scope items implemented
- [ ] `just --list` shows every recipe; workflow YAML files parse
- [ ] `just lint` / `just test` cannot fully run yet — `web/` and `server/` are created in P0-T02/P0-T03; the
      full lint/test/CI check is part of P0-T04
- [ ] Docs updated as listed above; plan.md checkboxes ticked
- [ ] Committed: `chore: add repository structure, justfile and CI workflows`

## If unclear

If anything in this task is ambiguous or conflicts with the docs, stop and ask before implementing.
