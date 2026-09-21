# P2-T09 — VPS provisioning and ops

## Context

The repository contains deploy artifacts and working `just release` / `just deploy` recipes (P2-T08). This task
puts the server into production. Most steps are **manual actions on the owner's VPS and cloud accounts**: you
(Claude Code) guide the owner through them step by step, verify each result from the outputs the owner pastes back
(or via `ssh` commands the owner approves), and turn the final, proven procedure into `deploy/README.md`.

## Read first

- `CLAUDE.md` (always)
- `deploy/README.md`, `deploy/*` (from P2-T08)
- `docs/architecture.md` §9, §10, §12, §13
- `docs/use_cases.md` UC-29

## Scope

From `docs/plan.md` §2.4 Deployment:

- [ ] Provision VPS: user, directories, Caddy, Litestream to S3-compatible bucket
- [ ] Restore drill: restore the DB from the bucket into a temp file and verify
- [ ] Uptime check on `/api/health`

## Out of scope

- Code changes to the server or web app (if a bug appears, stop, report and fix it in a separate `fix(...)` commit
  only after the owner agrees).
- Push, TTS, LLM keys — later phases.

## Before starting — ask the owner

1. VPS provider, hostname/IP, SSH user with sudo, Ubuntu version.
2. Domain for the app (e.g. `cards.<domain>`) and whether DNS is already pointing to the VPS.
3. S3-compatible provider (Backblaze B2, Cloudflare R2, Hetzner, AWS …), bucket name, endpoint, region; access key
   ready (never paste secrets into the chat or commit them — they go only into files on the VPS).
4. Uptime monitor of choice.

## Guided checklist

Walk through each item; do not proceed until its verify passes.

1. **DNS** — A/AAAA record for the domain → VPS IP.
   → verify: `dig +short cards.example.com` returns the VPS IP.
2. **Base system** — `apt update && apt upgrade`, unattended-upgrades enabled, firewall (`ufw allow OpenSSH`,
   `80/tcp`, `443/tcp`, `ufw enable`).
   → verify: `sudo ufw status` shows only 22, 80, 443.
3. **Service user and directories** — `useradd --system --home /var/lib/annette-cards --shell /usr/sbin/nologin
   annette`; create `/opt/annette-cards/releases`, `/var/lib/annette-cards` (owner `annette`, mode 0750),
   `/etc/annette-cards` (root:annette 0750).
   → verify: `ls -ld` on each path shows expected owner/mode.
4. **Env file** — copy `deploy/env.example` to `/etc/annette-cards/env`, fill real values on the VPS
   (`ANNETTE_PUBLIC_URL`, DB path, log format JSON), `chmod 0640`, `chown root:annette`.
   → verify: `sudo -u annette cat /etc/annette-cards/env` works; another user cannot read it.
5. **Sudo rule for deploy** — allow the deploy SSH user to run only `systemctl restart annette-cards` (and status)
   without password, as required by `just deploy`.
6. **systemd unit** — install `deploy/annette-cards.service` to `/etc/systemd/system/`, `systemctl daemon-reload`,
   `systemctl enable annette-cards`. `systemd-analyze security annette-cards` — record the exposure score.
7. **First deploy** — on the Mac: `just release` then `just deploy`.
   → verify: `systemctl status annette-cards` active; `curl -s http://127.0.0.1:8080/api/health` on the VPS OK.
8. **Caddy** — install from the official Caddy apt repository; install `deploy/Caddyfile` to
   `/etc/caddy/Caddyfile` with the real domain; `systemctl reload caddy`.
   → verify: `curl -sI https://cards.example.com/api/health` → 200, HSTS and CSP headers present; valid certificate.
9. **Admin account** — on the VPS: `sudo -u annette /opt/annette-cards/current/annette-cards create-user --email …
   --admin` (with the env file loaded — document the exact command in `deploy/README.md`).
   → verify: sign in from the iPhone at the public URL; install to Home Screen.
10. **Litestream** — install the official `.deb`; configure `/etc/litestream.yml` from `deploy/litestream.yml`
    with credentials in an env file readable only by root/`annette`; enable the service.
    → verify: `litestream snapshots /var/lib/annette-cards/annette.db` lists a snapshot; objects visible in the bucket.
11. **Restore drill** — `litestream restore -o /tmp/annette-restore.db /var/lib/annette-cards/annette.db`, then
    `sqlite3 /tmp/annette-restore.db 'PRAGMA integrity_check; SELECT count(*) FROM users; SELECT count(*) FROM cards;'`
    and compare with the live DB. Delete the temp file.
    → verify: `ok`, counts equal (or live ≥ restored by only the last seconds of changes).
12. **Restart safety** — `sudo systemctl restart annette-cards` and a full VPS `reboot`.
    → verify: service and Caddy come back; iPhone sync still works; data intact.
13. **Uptime check** — create an HTTP monitor for `https://<domain>/api/health` (1–5 min interval, alert to the
    owner's email/Telegram).
    → verify: monitor shows "up"; temporarily stop the service to confirm an alert arrives, then start it again.
14. **Rollback rehearsal** — deploy the same version twice under different release dirs (or a previous one) and run
    the rollback procedure from `deploy/README.md`.
    → verify: `/api/meta` shows the expected version after rollback and after rolling forward again.

## Tests

No automated tests are added. The verification is the checklist above; record the results (dates, commands, exposure
score, monitor provider — **no secrets**) in `deploy/README.md` under "Operations log / last restore drill".

## Invariants to respect

- Secrets never enter the repository, the chat transcript or logs.
- Any change of procedure discovered here is reflected in `deploy/` files, not only in the README.

## Docs to update

- `deploy/README.md`: complete provisioning section (exact commands that worked), restore drill procedure and last
  result, uptime monitor, rollback, sudo rule.
- `docs/architecture.md` §12/§13 if the real setup differs (e.g. Litestream config location, monitor).
- `README.md` Deployment: short pointer if changed.
- `docs/plan.md`: tick the three checkboxes.

## Definition of done

- [ ] All checklist items verified with the owner
- [ ] `deploy/` files match what runs on the VPS
- [ ] `just lint` and `just test` still green
- [ ] Docs updated as listed above; plan.md checkboxes ticked
- [ ] Committed: `docs(deploy): document VPS provisioning, restore drill and monitoring`

## If unclear

If anything in this task is ambiguous or conflicts with the docs, stop and ask before implementing.
