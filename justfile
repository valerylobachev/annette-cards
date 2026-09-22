# Annette Cards — development commands. Run `just` to list them.

# Recipes load server/.env (copy it from server/.env.example); a missing file is not an error.
set dotenv-load := true
set dotenv-path := "server/.env"

# sqlx-cli and the sqlx macros read DATABASE_URL. It is passed only to the recipes below that need a live database;
# lint and test use the committed server/.sqlx/ metadata, like CI.
database_url := env("ANNETTE_DATABASE_URL", "sqlite://data/annette.db")

# Deployment (deploy/README.md): the VPS as an ssh destination (e.g. `deploy@cards.example.com`) and the public URL.
# Set them in server/.env or the environment.
deploy_host := env("ANNETTE_DEPLOY_HOST", "")
deploy_url := env("ANNETTE_DEPLOY_URL", "")
release_target := "x86_64-unknown-linux-musl"
release_binary := "server/target/" + release_target + "/release/annette-cards"

# List all recipes
default:
    @just --list --unsorted

# Run the server (bacon, restarts on change) and the Vite dev server together; Ctrl-C stops both
dev:
    #!/usr/bin/env bash
    set -euo pipefail
    trap 'kill 0' INT TERM EXIT
    (cd server && DATABASE_URL={{ database_url }} bacon --headless) &
    (cd web && pnpm dev) &
    wait

# Run only the Vite dev server on :5173 (proxies /api to 127.0.0.1:8080)
dev-web:
    cd web && pnpm dev

# Run only the server on :8080 with bacon (rebuild and restart on save)
dev-server:
    cd server && DATABASE_URL={{ database_url }} bacon serve

# iPhone: join the same Wi-Fi, open https://<mac-ip>:5173 in Safari and accept the self-signed certificate.
# Vite over HTTPS on the LAN for testing on an iPhone
dev-https:
    cd web && VITE_HTTPS=1 pnpm dev --host

# Rust + TypeScript unit tests
test:
    cd server && cargo test
    cd web && pnpm vitest run

# Playwright end-to-end tests (WebKit and Chromium)
e2e:
    cd web && pnpm playwright test

# README and user-guide screenshots (docs/images/, WebKit on an iPhone viewport)
screenshots:
    cd web && SCREENSHOTS=1 pnpm playwright test --project screenshots

# clippy, rustfmt, biome, tsc
lint:
    cd server && cargo clippy --all-targets -- -D warnings
    cd server && cargo fmt --check
    cd web && pnpm biome check
    cd web && pnpm tsc --noEmit && pnpm tsc --noEmit -p tsconfig.sw.json

# Format Rust and TypeScript
fmt:
    cd server && cargo fmt
    cd web && pnpm biome check --write

# Regenerate web/openapi.json from the server and the TypeScript client in web/src/api/
gen-api:
    cd server && cargo run -q -- openapi > ../web/openapi.json
    cd web && pnpm orval

# Create a new reversible sqlx migration
db-new name:
    cd server && sqlx migrate add -r {{ name }}

# Create the local SQLite database and apply migrations
db-migrate:
    mkdir -p server/data
    cd server && sqlx database create -D {{ database_url }} && sqlx migrate run -D {{ database_url }}

# Refresh server/.sqlx/ offline query metadata (run after changing any query!)
sqlx-prepare: db-migrate
    cd server && DATABASE_URL={{ database_url }} cargo sqlx prepare -- --all-targets

# Production build: web first (it is embedded into the binary), then the release server binary
build:
    cd web && pnpm build
    cd server && cargo build --release

# Static Linux binary (x86_64 musl) for the VPS, with the PWA embedded; needs zig and cargo-zigbuild
release:
    cd web && pnpm build
    cd server && cargo zigbuild --release --target {{ release_target }}
    @echo "Built {{ release_binary }} ($(just _release-version))"

# Build, upload to the VPS as a new release, switch `current` to it, restart the service and check /api/health
deploy host=deploy_host url=deploy_url: release
    #!/usr/bin/env bash
    # The remote commands are built on this machine on purpose (the release path is chosen here).
    # shellcheck disable=SC2029
    set -euo pipefail
    host="{{ host }}"; url="{{ url }}"
    if [ -z "$host" ] || [ -z "$url" ]; then
      echo "Set ANNETTE_DEPLOY_HOST and ANNETTE_DEPLOY_URL (server/.env), or run: just deploy <ssh host> <https url>" >&2
      exit 1
    fi
    version="$(just _release-version)"
    release="/opt/annette-cards/releases/$version"
    echo "Deploying $version to $host"
    ssh "$host" "mkdir -p '$release'"
    scp -q "{{ release_binary }}" "$host:$release/annette-cards.tmp"
    # The new binary becomes visible at once: mv and the symlink switch (mv -T) are atomic renames.
    ssh "$host" "set -e; chmod 755 '$release/annette-cards.tmp'; mv '$release/annette-cards.tmp' '$release/annette-cards'; \
      cd /opt/annette-cards && ln -sfn 'releases/$version' current.new && mv -T current.new current; \
      sudo systemctl restart annette-cards"
    just _wait-healthy "$url"
    echo "Deployed $version"

# Switch the VPS back to an earlier release (see `just releases`) and restart
rollback version host=deploy_host url=deploy_url:
    #!/usr/bin/env bash
    set -euo pipefail
    host="{{ host }}"; url="{{ url }}"
    if [ -z "$host" ] || [ -z "$url" ]; then
      echo "Set ANNETTE_DEPLOY_HOST and ANNETTE_DEPLOY_URL (server/.env)" >&2
      exit 1
    fi
    ssh "$host" "set -e; cd /opt/annette-cards; test -x 'releases/{{ version }}/annette-cards' || \
      { echo 'No release {{ version }}; available:' >&2; ls releases >&2; exit 1; }; \
      ln -sfn 'releases/{{ version }}' current.new && mv -T current.new current; \
      sudo systemctl restart annette-cards"
    just _wait-healthy "$url"
    echo "Rolled back to {{ version }}"

# List the releases on the VPS, newest last, and the current one
releases host=deploy_host:
    @ssh "{{ host }}" "ls -1tr /opt/annette-cards/releases && echo current: \$(readlink /opt/annette-cards/current)"

# `<package version>-<git sha>`, with `-dirty` when there are uncommitted changes
_release-version:
    #!/usr/bin/env bash
    set -euo pipefail
    version="$(sed -n 's/^version = "\(.*\)"/\1/p' server/Cargo.toml | head -n1)"
    sha="$(git rev-parse --short HEAD)"
    dirty="$(git diff --quiet HEAD -- server web || echo -dirty)"
    echo "$version-$sha$dirty"

# Poll <url>/api/health for up to 30 s; fail loudly if the server does not come up
_wait-healthy url:
    #!/usr/bin/env bash
    set -euo pipefail
    for _ in $(seq 1 30); do
      if curl -fsS --max-time 2 "{{ url }}/api/health" > /dev/null 2>&1; then
        echo "Healthy: {{ url }}/api/health"
        exit 0
      fi
      sleep 1
    done
    echo "ERROR: {{ url }}/api/health did not answer OK within 30 s. Check: journalctl -u annette-cards -n 50" >&2
    exit 1
