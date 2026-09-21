# Tech Stack

This document lists the technologies used in Annette Cards, why each was chosen, and which alternatives were
rejected. Versions: use the latest stable release at bootstrap time and pin them in `package.json`,
`pnpm-lock.yaml`, `Cargo.toml` and `Cargo.lock`.

## Guiding constraints

- **Offline-first PWA on iPhone.** The app must be fully usable without a network, installed from Safari to the
  Home Screen.
- **Lightweight backend.** A single binary, a single SQLite file, no mandatory external services for core
  features.
- **Small user base.** The owner plus a few invited users. Simplicity beats horizontal scalability.
- **Learning Rust.** The backend is also a learning project; choose mainstream, well-documented crates.
- **Typed contract end to end.** Rust types → OpenAPI → generated TypeScript client.

## Client (`web/`)

| Concern | Choice | Rationale |
| --- | --- | --- |
| Language | TypeScript (strict) | Type safety, shared types via generated client |
| Framework | React 19 | Owner's primary UI stack |
| Build tool | Vite | Fast dev server, first-class PWA plugin |
| Package manager | pnpm | Fast, strict dependency resolution |
| Routing | TanStack Router (code-based routes in `src/app/router.tsx`) | Type-safe routes and search params; code-based avoids a generator plugin and a generated route tree for ~17 flat routes |
| Styling | Tailwind CSS 4 | Utility-first, mobile-first, dark mode via `prefers-color-scheme` |
| Components | shadcn/ui (Radix primitives, `radix-nova` style) | Accessible, copy-in components that we own; brings `radix-ui`, `class-variance-authority`, `cn`, `tw-animate-css` |
| Gestures / animation | `motion` (formerly framer-motion) | Drag with velocity/threshold for swipe cards, spring animations |
| Local database | Dexie (IndexedDB) + `dexie-react-hooks` | Versioned schema, transactions, reactive `useLiveQuery` |
| Spaced repetition | `ts-fsrs` | Reference FSRS implementation, runs offline on the client |
| Server state | TanStack Query | Caching and retries for auth, audio, enrich calls |
| API client | orval | Generates typed client + TanStack Query hooks from OpenAPI |
| PWA | `vite-plugin-pwa` (Workbox) | Manifest, precache, runtime caching, update prompt |
| Text-to-speech | Web Speech API (`speechSynthesis`) | Built into Safari, uses iOS system voices, offline |
| CSV/TSV parsing | PapaParse | Delimiter auto-detection, streaming, robust quoting |
| i18n | i18next + react-i18next + `i18next-browser-languagedetector` | RU/EN UI, pluralization rules for Russian; the detector picks the stored choice, then `navigator.language` |
| Charts | Recharts | Simple React charts for statistics |
| Dates | date-fns | Tree-shakable, handles day boundaries and locales |
| IDs | `uuid` (v7) | Time-ordered IDs generated offline |
| String distance | small in-house Damerau–Levenshtein in `domain/` | Typing-mode tolerance; no dependency needed |
| Lint / format | Biome | One fast tool for lint + format |
| Unit tests | Vitest + Testing Library + `fake-indexeddb` | Vite-native, fast |
| E2E tests | Playwright (WebKit, Chromium) | WebKit approximates iOS Safari |
| Dev HTTPS | `@vitejs/plugin-basic-ssl` | Self-signed HTTPS for `just dev-https` (service workers on a real iPhone need HTTPS) |

## Server (`server/`)

| Concern | Crate | Rationale |
| --- | --- | --- |
| Language | Rust (edition 2024) | Performance, single static binary, learning goal |
| Async runtime | `tokio` | De facto standard |
| HTTP framework | `axum` | Ergonomic extractors, tower middleware, close in spirit to Go's chi |
| Middleware | `tower-http` | CORS (dev only), compression, request tracing, timeouts |
| Rate limiting | `tower_governor` | Per-IP/per-user limits for login, enrich, audio |
| Database | `sqlx` with SQLite | Compile-time checked SQL, migrations, offline mode (`.sqlx/`) |
| Serialization | `serde`, `serde_json` | Standard |
| OpenAPI | `utoipa`, `utoipa-axum` | Spec generated from handler/DTO types; exported via CLI for orval |
| Errors | `thiserror` (domain), `anyhow` (startup/CLI) | Conventional split |
| Logging | `tracing`, `tracing-subscriber` (JSON in prod) | Structured logs, request spans |
| Configuration | `figment` (env + optional TOML) | Typed config with `ANNETTE_` prefix |
| CLI | `clap` (derive) | `serve`, `create-user`, `invite`, `openapi`, `purge` subcommands |
| Password hashing | `argon2` (Argon2id) | Current best practice |
| Sessions | Opaque random tokens (`rand`) stored hashed (`sha2`) in SQLite, `axum-extra` cookies | Simple, revocable, no JWT key management |
| HTTP client | `reqwest` (rustls) | Calls to TTS, Wikimedia, LLM APIs |
| Static assets | `rust-embed` + `mime_guess` | PWA embedded into the binary; one-file deployment; `mime_guess` sets `Content-Type` from the file extension |
| IDs | `uuid` (v7) | Same format as the client |
| Web Push | `web-push` | VAPID-signed notifications (Phase 4) |
| Scheduling | `tokio` interval tasks | Reminder dispatch, purge jobs; no cron dependency |
| FSRS optimizer | `fsrs` (fsrs-rs) | Official optimizer to fit per-user weights (Phase 4) |
| Tests | built-in + `#[sqlx::test]`, `tower::ServiceExt` (dev: `tower` with `util`, `http-body-util` to read bodies) | No extra frameworks needed |

### Why sessions instead of JWT

An earlier draft proposed JWT. For a same-origin PWA with a handful of users, an opaque session token in an
`HttpOnly; Secure; SameSite=Strict` cookie is simpler and safer: it is revocable (logout, "sign out other
devices"), needs no signing keys or refresh-token rotation, and is not accessible to JavaScript. Offline use
does not require authentication at all, so long-lived sliding sessions (90 days) are acceptable.

## Database

| Concern | Choice | Rationale |
| --- | --- | --- |
| Engine | SQLite (WAL mode, `foreign_keys=ON`, `busy_timeout`) | Zero-ops, one file, fast enough for a few users |
| Migrations | sqlx migrations, applied on startup | Versioned, embedded in the binary |
| Audio storage | BLOBs in SQLite (`audio_assets`) | 10–40 KB per clip; backed up by Litestream together with data. Revisit if DB > 1 GB |
| Backups | Litestream → S3-compatible bucket | Continuous replication, point-in-time restore |

Rejected: PostgreSQL (unnecessary ops for this scale; sqlx makes a later migration feasible), libSQL/Turso
(extra dependency without a current need), embedded key-value stores such as redb/sled (no SQL, awkward
queries), SurrealDB (immature, heavy).

## External services (optional, server-side only)

| Service | Use | Notes |
| --- | --- | --- |
| Azure AI Speech (primary TTS) | Generate MP3 with SSML and IPA `<phoneme>` | Neural voices for en-GB/en-US/pl-PL; behind a `TtsProvider` trait so Google Cloud TTS can be added |
| Wikimedia Commons / Wiktionary API | Native speaker recordings | Store attribution and license (CC BY-SA); may require transcoding (see architecture open questions) |
| Anthropic API | Card enrichment (translation, example, IPA, notes) | Model configurable via `ANNETTE_LLM_MODEL`; behind an `Enricher` trait |

All external services are optional. Without keys, the corresponding features are hidden in the UI (the server
reports enabled features via `GET /api/meta`).

## Infrastructure

| Concern | Choice |
| --- | --- |
| Host | Small VPS (1–2 vCPU, 2 GB RAM, Ubuntu LTS) |
| Reverse proxy / TLS | Caddy (automatic Let's Encrypt certificates, HTTP/2/3, compression) |
| Process manager | systemd unit with hardening options |
| Build | `cargo-zigbuild` for `x86_64-unknown-linux-musl` from macOS (Apple Silicon) |
| CI | GitHub Actions: lint, test, build; release artifact on tag |
| Deploy | `just deploy`: scp binary, atomic symlink switch, `systemctl restart` |
| Containers | Optional (distroless image); not required |

## Developer tooling

| Tool | Use |
| --- | --- |
| `just` | Command runner (see `justfile`) |
| `bacon` | Rust rebuild/check on save |
| `sqlx-cli` | Migrations, `cargo sqlx prepare` (same minor version as the `sqlx` crate, currently 0.9) |
| `cargo-zigbuild` | Cross-compilation |
| Biome | TS lint + format |
| Playwright | E2E tests |
| Claude Code | Implementation assistant; follows `CLAUDE.md` |
