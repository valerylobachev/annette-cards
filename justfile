# Annette Cards — development commands. Run `just` to list them.

# Recipes load server/.env (copy it from server/.env.example); a missing file is not an error.
set dotenv-load := true
set dotenv-path := "server/.env"

# sqlx-cli and the sqlx macros read DATABASE_URL. It is passed only to the recipes below that need a live database;
# lint and test use the committed server/.sqlx/ metadata, like CI.
database_url := env("ANNETTE_DATABASE_URL", "sqlite://data/annette.db")

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

# clippy, rustfmt, biome, tsc
lint:
    cd server && cargo clippy --all-targets -- -D warnings
    cd server && cargo fmt --check
    cd web && pnpm biome check
    cd web && pnpm tsc --noEmit

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

# Static Linux binary (x86_64 musl) for the VPS; needs zig and cargo-zigbuild
release:
    cd web && pnpm build
    cd server && cargo zigbuild --release --target x86_64-unknown-linux-musl

# Ship the release binary to the VPS and restart the service
deploy:
    @echo "just deploy is implemented in P2-T08" && exit 1
