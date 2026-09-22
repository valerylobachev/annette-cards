# Deploying Annette Cards

One static binary serves the API and the PWA. On the VPS it runs under systemd as the user `annette`, behind Caddy
(HTTPS), with the SQLite database replicated continuously to an S3-compatible bucket by Litestream
(`docs/architecture.md` §12).

| File | Installed as | Purpose |
| --- | --- | --- |
| `Caddyfile` | `/etc/caddy/Caddyfile` | HTTPS, HSTS, compression, proxy to `127.0.0.1:8080` |
| `annette-cards.service` | `/etc/systemd/system/annette-cards.service` | The server, hardened (read-only system, writes only to `/var/lib/annette-cards`) |
| `env.example` | `/etc/annette-cards/env` (0640 root:annette) | Server settings and secrets |
| `litestream.yml` | `/etc/annette-cards/litestream.yml` | Replication of `/var/lib/annette-cards/annette.db` |
| `litestream.env.example` | `/etc/annette-cards/litestream.env` (0640 root:annette) | Bucket, endpoint and keys for Litestream |
| `litestream.service` | `/etc/systemd/system/litestream.service` | Litestream as the user `annette` |
| `annette-cards-admin` | `/usr/local/bin/annette-cards-admin` | Runs the CLI (`create-user`, `invite`) as `annette` with the server's settings |

Layout on the VPS:

```
/opt/annette-cards/releases/<version>/annette-cards   # one directory per deploy (0.1.0-ff4c635)
/opt/annette-cards/current -> releases/<version>      # what systemd starts
/var/lib/annette-cards/annette.db                     # the database (+ -wal, -shm, Litestream's state)
/etc/annette-cards/{env,litestream.yml,litestream.env}
```

## Prerequisites

On the Mac: `just`, Node LTS + `pnpm`, Rust with the `x86_64-unknown-linux-musl` target
(`rustup target add x86_64-unknown-linux-musl`), `zig` (`brew install zig`) and `cargo-zigbuild`
(`cargo install --locked cargo-zigbuild`); an SSH key for the VPS.

For the VPS: Ubuntu LTS (1–2 vCPU, 2 GB RAM), a DNS A/AAAA record for the domain, an S3-compatible bucket with an
access key pair, an uptime monitor account.

## One-time provisioning

The exact run on the real VPS is recorded in P2-T09; the steps:

1. **Deploy user.** Log in as a user with sudo (called `deploy` here) using an SSH key. It owns the releases and
   may restart the service without a password:

   ```bash
   sudo useradd --system --home /var/lib/annette-cards --shell /usr/sbin/nologin annette
   sudo install -d -o deploy -g deploy /opt/annette-cards /opt/annette-cards/releases
   sudo install -d -o annette -g annette -m 750 /var/lib/annette-cards
   sudo install -d -o root -g annette -m 750 /etc/annette-cards
   echo 'deploy ALL=(root) NOPASSWD: /usr/bin/systemctl restart annette-cards' | sudo tee /etc/sudoers.d/annette-cards
   sudo chmod 440 /etc/sudoers.d/annette-cards
   ```

2. **Settings.** Copy `env.example` and `litestream.env.example` to the VPS and fill them in (`ANNETTE_PUBLIC_URL`
   must be the exact public origin, e.g. `https://cards.example.com`):

   ```bash
   sudo install -m 640 -o root -g annette env.example /etc/annette-cards/env
   sudo install -m 640 -o root -g annette litestream.env.example /etc/annette-cards/litestream.env
   sudo install -m 644 litestream.yml /etc/annette-cards/litestream.yml
   sudoedit /etc/annette-cards/env /etc/annette-cards/litestream.env
   ```

3. **Caddy.** Install from the official repository (<https://caddyserver.com/docs/install#debian-ubuntu-raspbian>),
   then:

   ```bash
   sudo install -m 644 Caddyfile /etc/caddy/Caddyfile
   sudo systemctl edit caddy        # [Service] Environment=ANNETTE_DOMAIN=cards.example.com
   sudo systemctl restart caddy
   ```

   Ports 80 and 443 must be open (80 for the certificate challenge and the redirect to HTTPS).

4. **Server.** Install the unit and the admin wrapper, then deploy from the Mac (next section):

   ```bash
   sudo install -m 644 annette-cards.service /etc/systemd/system/
   sudo install -m 755 annette-cards-admin /usr/local/bin/
   sudo systemctl daemon-reload
   sudo systemctl enable annette-cards   # started by the first `just deploy`
   ```

5. **Litestream.** Install version 0.3.13 (the configuration is written for 0.3.x; it also parses with 0.5):

   ```bash
   curl -fsSLO https://github.com/benbjohnson/litestream/releases/download/v0.3.13/litestream-v0.3.13-linux-amd64.deb
   sudo dpkg -i litestream-v0.3.13-linux-amd64.deb
   sudo systemctl disable --now litestream   # the package's unit runs as root with /etc/litestream.yml
   sudo install -m 644 litestream.service /etc/systemd/system/litestream.service
   sudo systemctl daemon-reload && sudo systemctl enable --now litestream
   ```

   Start it after the first deploy has created the database.

6. **First admin and invites** (UC-28, UC-29):

   ```bash
   annette-cards-admin create-user --email you@example.com --name "Your name" --admin   # asks for the password
   annette-cards-admin invite --note Anna --days 7                                       # prints the link
   ```

   Invites can also be created in the app: Settings → Account & sync → Invites.

## Deploy

In `server/.env` on the Mac:

```bash
ANNETTE_DEPLOY_HOST=deploy@cards.example.com   # ssh destination
ANNETTE_DEPLOY_URL=https://cards.example.com   # checked at /api/health after the restart
```

```bash
just deploy          # build (web + static binary), upload, switch `current`, restart, wait for /api/health
just releases        # releases on the VPS and the current one
just rollback 0.1.0-ff4c635   # switch back to an earlier release and restart
```

A release is named `<Cargo version>-<git sha>`, with `-dirty` when `server/` or `web/` has uncommitted changes.
The binary is uploaded next to the running one and put in place with atomic renames; the restart takes about a
second. Migrations run at startup: a failing migration stops the new binary, and `just deploy` fails on the health
check — roll back, the old binary works with the old schema. Migrations only add tables and columns, so an older
binary also runs on a newer schema.

`just deploy <host> <url>` overrides the settings. Old releases stay in `/opt/annette-cards/releases`; delete ones
you no longer need.

## Optional features (audio, AI)

Each feature stays off until its settings are in `/etc/annette-cards/env` (`sudoedit /etc/annette-cards/env`, then
`sudo systemctl restart annette-cards`); `GET /api/meta` shows which are on, and the app hides the others.

| Variables | Feature |
| --- | --- |
| `ANNETTE_AZURE_TTS_KEY`, `ANNETTE_AZURE_TTS_REGION` | Generated pronunciation (Azure AI Speech key and region, e.g. `westeurope`) |
| `ANNETTE_COMMONS_ENABLED` | Native-speaker recordings from Wikimedia Commons (default `true`, no key) |
| `ANTHROPIC_API_KEY`, `ANNETTE_LLM_MODEL`, `ANNETTE_ENRICH_DAILY_LIMIT` | AI suggestions (key without the `ANNETTE_` prefix; model default `claude-haiku-4-5`; 200 suggestions per user and UTC day) |
| `ANNETTE_VAPID_PUBLIC_KEY`, `ANNETTE_VAPID_PRIVATE_KEY` | Daily study reminders (Web Push); see below |

```bash
curl -s https://cards.example.com/api/meta   # {"version":"…","features":{"tts":true,"commons":true,"enrich":true,"push":false}}
```

Keys are read only by the server and never logged; the file must stay mode 0640 root:annette.

### VAPID keys for reminders

Generate the key pair once (any machine with OpenSSL) and put both lines into `/etc/annette-cards/env`; keep the
private key nowhere else. The server refuses to start when the public key does not belong to the private key.

```bash
openssl ecparam -name prime256v1 -genkey -noout -out vapid.pem
echo "ANNETTE_VAPID_PRIVATE_KEY=$(openssl ec -in vapid.pem -outform DER 2>/dev/null | tail -c +8 | head -c 32 | base64 | tr -d '=' | tr '/+' '_-')"
echo "ANNETTE_VAPID_PUBLIC_KEY=$(openssl ec -in vapid.pem -pubout -outform DER 2>/dev/null | tail -c 65 | base64 | tr -d '=' | tr '/+' '_-')"
rm vapid.pem
```

Changing the keys later invalidates every subscription: each device turns reminders on again (Settings →
Reminders). `ANNETTE_PUBLIC_URL` is sent to the push services as the contact (`sub` claim). Reminders reach an
iPhone only when the app is installed to the Home Screen (iOS 16.4+).

## Logs and status

```bash
journalctl -u annette-cards -f               # JSON lines: request_id, path, status, latency_ms, hashed user
systemctl status annette-cards litestream caddy
curl -fsS https://cards.example.com/api/health
```

## Backups

Litestream sends every change to the bucket within about a second, takes a full snapshot daily and keeps three
days of history (`litestream.yml`).

```bash
sudo -u annette sh -c 'set -a; . /etc/annette-cards/litestream.env; litestream generations -config /etc/annette-cards/litestream.yml /var/lib/annette-cards/annette.db'
sudo -u annette sh -c 'set -a; . /etc/annette-cards/litestream.env; litestream snapshots -config /etc/annette-cards/litestream.yml /var/lib/annette-cards/annette.db'
```

**Verify a backup** (restore drill, without touching the live database):

```bash
sudo -u annette sh -c 'set -a; . /etc/annette-cards/litestream.env; litestream restore -config /etc/annette-cards/litestream.yml -o /tmp/restore-check.db /var/lib/annette-cards/annette.db'
sqlite3 /tmp/restore-check.db 'PRAGMA integrity_check; SELECT COUNT(*) FROM users; SELECT COUNT(*) FROM cards;'
rm /tmp/restore-check.db
```

## Restore

After losing the VPS or the database file:

```bash
sudo systemctl stop annette-cards litestream
sudo mv /var/lib/annette-cards/annette.db /var/lib/annette-cards/annette.db.broken 2>/dev/null || true
sudo rm -f /var/lib/annette-cards/annette.db-wal /var/lib/annette-cards/annette.db-shm
sudo -u annette sh -c 'set -a; . /etc/annette-cards/litestream.env; litestream restore -config /etc/annette-cards/litestream.yml /var/lib/annette-cards/annette.db'
sudo chown annette:annette /var/lib/annette-cards/annette.db
sudo systemctl start annette-cards litestream
curl -fsS https://cards.example.com/api/health
```

`litestream restore -timestamp 2026-09-21T12:00:00Z …` restores an earlier point in time (within the retention).
Devices keep their local data. After a restore to an earlier point their sync cursor can be ahead of the restored
server, so they would not pull rows written after the restore: on each device tap **Sync now** (this pushes its
changes, which do not depend on the cursor), then sign out and in again (Settings → Account & sync) to pull
everything.
