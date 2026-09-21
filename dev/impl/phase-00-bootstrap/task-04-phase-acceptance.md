# P0-T04 — Phase 0 acceptance

## Context

P0-T01…P0-T03 created the repository tooling, the React PWA shell and the Rust server skeleton. This task adds
no features. It verifies the Phase 0 acceptance criteria end to end on a clean checkout, fixes any gaps found,
and makes sure CI is green before Phase 1 starts. Phase 1 builds entirely on this foundation, so tooling
problems must be fixed now.

## Read first

- `CLAUDE.md` (always) — Commands, Definition of done
- `docs/plan.md` — Phase 0 (all checkboxes and Acceptance)
- `dev/impl/phase-00-bootstrap/00-phase-overview.md` — Phase acceptance and added criteria
- `README.md` — Getting started

## Scope

From `docs/plan.md` (Phase 0 · Acceptance):

> `just dev` shows the app shell with tabs in RU/EN; `/api/health` returns OK; CI passes;
> `just build` produces one binary that serves the PWA.

Added criteria (from the phase overview):

- `just lint` and `just test` pass on a clean checkout.
- `just gen-api` is idempotent (no diff on a second run).
- `server/.env.example` copied to `server/.env` is enough to start the server.

## Out of scope

- New features, refactors or dependency upgrades not needed to meet the criteria.
- Anything from Phase 1 (data layer, screens).

## Implementation steps

1. Clean checkout: `git clone` the repository into a temp directory (or `git clean -xdf` after committing
   everything), `cd web && pnpm install --frozen-lockfile`, `cp server/.env.example server/.env`.
   → verify: no untracked files needed beyond `.env`.
2. Follow `README.md` → Getting started literally (skipping `create-user`, which arrives in P2-T01).
   → verify: every command works as written; fix the README or recipes where they differ.
3. `just lint` → verify: clippy, rustfmt, biome, tsc all clean.
4. `just test` → verify: `cargo test` and `pnpm vitest run` pass.
5. `just e2e` → verify: WebKit and Chromium projects pass (`shell.spec.ts`).
6. `just dev` → open `http://localhost:5173`:
   - four tabs visible and navigable; switch language RU ↔ EN and all tab labels change;
   - `http://localhost:5173/api/health` returns `{"status":"ok"}` through the proxy;
   - `/api/meta` shows the version and all features `false`.
   → verify: manual check; record the results in the commit message body.
7. `just gen-api` twice → verify: `git status` clean after the second run.
8. `just build` → run `server/target/release/annette-cards serve`; open `http://127.0.0.1:8080/`:
   app shell loads, deep link `/decks` loads, `/api/health` OK, service worker registers, manifest valid.
   Stop the server, reload: the shell loads from the service worker (DevTools offline).
   → verify: manual check in Safari (or WebKit via Playwright) and Chrome.
9. Push to GitHub → verify: the `ci.yml` workflow is green for both jobs. Optionally push a test tag
   (`v0.0.1-rc`) to verify `release.yml` produces the musl binary; delete the tag and release afterwards if it
   was only a test (ask the owner before pushing tags).
10. Fix every failure found in steps 1–9 in the smallest possible way; re-run the affected checks.
11. Review `docs/plan.md` Phase 0: every checkbox (including `(added)` ones) is ticked; if something was not
    done, implement it or report it to the owner.

## Tests

No new tests unless a gap is found; if a bug is fixed, add a test that reproduces it first.
Manual checks from steps 6 and 8 are listed in the commit message body.

## Invariants to respect

- No hardcoded UI strings slipped into placeholders (grep `web/src` for literal JSX text).
- `server/.sqlx/`, `web/src/api/`, `Cargo.lock`, `pnpm-lock.yaml` are committed; `server/.env` is not.

## Docs to update

- `README.md` → Status line: "Phase 0 complete; Phase 1 (Local MVP) in progress"; fix any Getting-started
  command that did not work as written.
- `CLAUDE.md` → fix any recipe description that does not match the `justfile`.
- `docs/plan.md` → confirm all Phase 0 checkboxes are ticked.

## Definition of done

- [ ] All acceptance criteria (plan.md + added) verified
- [ ] `just test`, `just e2e` (WebKit mandatory) and `just lint` pass
- [ ] CI green on GitHub
- [ ] App shell works offline in WebKit after one online visit
- [ ] Docs updated as listed above
- [ ] Committed: `chore: verify phase 0 acceptance` (or `fix(...)` commits for gaps, then this one)

## If unclear

If anything in this task is ambiguous or conflicts with the docs, stop and ask before implementing.
