# P2-T08 — Deploy artifacts

## Context

Accounts and sync work locally (P2-T01…T07). Before provisioning the VPS (P2-T09), the repository needs
everything required to run in production: Caddy, systemd and Litestream configuration, an env template, and
working `just release` / `just deploy` recipes (stubbed in Phase 0). Everything here is testable on the Mac.

## Read first

- `CLAUDE.md` (always) — Commands table
- `docs/architecture.md` §9 (HTTPS/HSTS, secrets), §10 (all variables), §12 (deployment), §13
- `docs/tech_stack.md` → Infrastructure, `cargo-zigbuild`
- `docs/use_cases.md` UC-29
- existing `justfile`, `server/.env.example`

## Scope

From `docs/plan.md` §2.4 Deployment:

- [ ] `deploy/`: Caddyfile, systemd unit with hardening, env template, `litestream.yml`, `deploy/README.md`
- [ ] `just release` (cargo-zigbuild, musl) and `just deploy` (upload, symlink switch, restart)

## Out of scope

- Actually provisioning the VPS, restore drill, uptime monitor → P2-T09.
- Variables for TTS/LLM/VAPID are included in the env template as commented placeholders only.

## Implementation steps

1. **Caddyfile** (`deploy/Caddyfile`): site `{$ANNETTE_DOMAIN}` (document replacing `cards.example.com`),
   `encode zstd gzip`, `reverse_proxy 127.0.0.1:8080`, header `Strict-Transport-Security "max-age=31536000"`.
   → verify: `caddy validate --config deploy/Caddyfile --adapter caddyfile` (if Caddy is installed locally; otherwise
   `caddy fmt` via Docker or note manual check).
2. **systemd unit** (`deploy/annette-cards.service`): `User=annette`, `Group=annette`,
   `ExecStart=/opt/annette-cards/current/annette-cards serve`, `EnvironmentFile=/etc/annette-cards/env`,
   `WorkingDirectory=/var/lib/annette-cards`, `Restart=on-failure`, hardening: `ProtectSystem=strict`,
   `ReadWritePaths=/var/lib/annette-cards`, `NoNewPrivileges=true`, `PrivateTmp=true`, `ProtectHome=true`,
   `ProtectKernelTunables=true`, `ProtectControlGroups=true`, `RestrictSUIDSGID=true`, `LockPersonality=true`.
   → verify: `systemd-analyze verify` on a Linux box/CI container, or document as checked in P2-T09.
3. **Litestream** (`deploy/litestream.yml` + `deploy/litestream.service` if the package unit is not used):
   `dbs: - path: /var/lib/annette-cards/annette.db` with one S3-compatible replica using `${LITESTREAM_*}` env vars
   (`bucket`, `path: annette`, `endpoint`, `region`), `sync-interval`, retention (e.g. 72h snapshots).
4. **Env template** (`deploy/env.example`): every §10 variable with production values/placeholders:
   `ANNETTE_BIND=127.0.0.1:8080`, `ANNETTE_DATABASE_URL=sqlite:///var/lib/annette-cards/annette.db`,
   `ANNETTE_PUBLIC_URL=https://cards.example.com`, `ANNETTE_SESSION_TTL_DAYS=90`, log format JSON, `RUST_LOG=info`,
   commented TTS/LLM/VAPID keys. File mode note: `0640 root:annette`.
5. **`just release`**: `pnpm --dir web build` → embed → `cargo zigbuild --release --target
   x86_64-unknown-linux-musl`; print the output path and version (from `Cargo.toml`).
   → verify: `file target/x86_64-unknown-linux-musl/release/annette-cards` reports a static x86-64 ELF.
6. **`just deploy`** with variables `host` (default from env `ANNETTE_DEPLOY_HOST`) and version from `Cargo.toml` +
   short git sha: `ssh` mkdir `/opt/annette-cards/releases/<version>`, `scp` the binary, `ln -sfn` into
   `/opt/annette-cards/current.new` then `mv -T current.new current` (atomic), `sudo systemctl restart
   annette-cards`, then poll `https://$DOMAIN/api/health` up to 30 s and fail loudly if not OK. Add
   `just rollback <version>` doing the symlink switch + restart (added convenience; ask the owner if not wanted).
   → verify: `just --dry-run deploy` prints the expected commands.
7. **`deploy/README.md`**: prerequisites; one-time provisioning steps (filled in P2-T09); deploy; rollback; logs
   (`journalctl -u annette-cards -f`); backups (Litestream status); restore procedure
   (stop → `litestream restore -o /var/lib/annette-cards/annette.db …` → chown → start); first admin via
   `annette-cards create-user --email … --admin`; invites via CLI.
8. CI: extend the release-on-tag workflow (Phase 0) to use the same `just release` recipe if it does not already.

## Tests

- `just release` produces a musl binary; run it locally in a Linux container (`docker run --rm -v … alpine`) with
  `serve` and a temp DB → `curl /api/health` returns OK and `/` serves the PWA. (If Docker is unavailable, document
  the manual check for P2-T09.)
- Unit/router tests unchanged and green.
- Shell scripts, if any, pass `shellcheck`.

## Invariants to respect

- Secrets only on the server in `/etc/annette-cards/env`; never committed (only `env.example`).
- `just` recipes are the single entry point for release and deploy.
- One binary serves API + PWA.

## Rust learning notes (server tasks only)

- **Cross-compilation** with `cargo-zigbuild` and the `x86_64-unknown-linux-musl` target; why musl produces a
  static binary; rustls vs OpenSSL for static builds.

## Docs to update

- `CLAUDE.md` Commands: `just release`, `just deploy` (and `just rollback` if added) with real behavior.
- `README.md` Deployment section: link to `deploy/README.md`.
- `docs/architecture.md` §10 (deploy-only variables such as `ANNETTE_DEPLOY_HOST`, `LITESTREAM_*`), §12 if
  anything differs.
- `docs/tech_stack.md` if any tool is added.
- `docs/plan.md`: tick the two checkboxes.

## Definition of done

- [ ] All scope items implemented
- [ ] `just release` produces a working static binary; `just --dry-run deploy` correct
- [ ] `just lint` and `just test` green
- [ ] Docs updated as listed above; plan.md checkboxes ticked
- [ ] Committed: `chore(deploy): add Caddy, systemd, Litestream config and release/deploy recipes`

## If unclear

If anything in this task is ambiguous or conflicts with the docs, stop and ask before implementing.
