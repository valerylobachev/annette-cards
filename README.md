# Annette Cards

Learn words from your own dictionary — with spaced repetition and real pronunciation — on your iPhone.

Annette Cards is a Duocards-style flashcard app built as an offline-first Progressive Web App with a small Rust
backend. Import your word lists from CSV/TSV, swipe through cards, hear every word pronounced, and let the FSRS
algorithm decide when you should see each word again.

> **Status:** Phase 1 (local MVP) implemented and verified by automated tests: the app works fully offline;
> the real-iPhone acceptance check is pending. Backend and sync come in Phase 2 (see [`docs/plan.md`](docs/plan.md)).

## Features

- **Your own dictionary.** Decks with any language pair; import CSV/TSV with column mapping; manual and quick add.
- **Spaced repetition.** FSRS scheduling (`ts-fsrs`), forward and reverse directions, daily limits.
- **Study modes.** Swipe cards (Duocards-style), multiple choice, listening, typing with typo tolerance.
- **Pronunciation.** System voices via Web Speech API; server-generated audio (cloud TTS with IPA) or native
  speaker recordings from Wikimedia Commons for tricky words.
- **AI enrichment.** Type a word, get translation, example, IPA and notes suggested by an LLM.
- **Offline-first.** Everything works without a network; changes sync when you are back online.
- **Multi-device sync.** Invite-only accounts for a few users; data syncs between iPhone and laptop.
- **Statistics and reminders.** Progress charts, streaks, workload forecast, Web Push reminders.
- **Bilingual UI.** Russian and English.

## Tech stack

| Layer | Technology |
| --- | --- |
| Client | React 19, Vite, TypeScript, Tailwind 4, shadcn/ui, Dexie (IndexedDB), ts-fsrs, vite-plugin-pwa |
| Server | Rust, axum, tokio, sqlx, utoipa, rust-embed |
| Database | SQLite (WAL) + Litestream backups |
| Hosting | Single static binary behind Caddy on a VPS (systemd) |

Details: [`docs/tech_stack.md`](docs/tech_stack.md).

## Repository structure

```
web/       React PWA
server/    Rust backend (serves the API and the embedded PWA)
deploy/    Caddyfile, systemd unit, Litestream config
docs/      Product and technical documentation
justfile   Development commands
```

## Getting started

### Prerequisites

- Rust (stable, edition 2024) with `cargo`
- Node.js LTS and `pnpm`
- [`just`](https://github.com/casey/just), [`bacon`](https://github.com/Canop/bacon),
  `sqlx-cli` (`cargo install sqlx-cli --no-default-features --features sqlite`)
- For release builds: `zig` and `cargo-zigbuild`

### Development

```bash
cp server/.env.example server/.env    # set ANNETTE_* variables
just db-migrate                       # create the local SQLite database
cargo run --manifest-path server/Cargo.toml -- create-user --email you@example.com --admin  # from Phase 2
just dev                              # server on :8080, Vite on :5173 with /api proxy
```

Open `http://localhost:5173`. To test on an iPhone during development, run `just dev-https` (Vite over HTTPS on
the LAN with a self-signed certificate) and open `https://<mac-ip>:5173` in Safari — service workers require
HTTPS.

### Common commands

```bash
just test       # Rust + TypeScript unit tests
just e2e        # Playwright (WebKit)
just lint       # clippy, rustfmt, biome, tsc
just gen-api    # regenerate TS client from the server's OpenAPI spec
just build      # production build with embedded PWA
just release    # static Linux binary (x86_64 musl)
just deploy     # ship to the VPS
```

## Import format

UTF-8 CSV or TSV, usually with a header row; the delimiter (`,` `;` or tab) is detected automatically. Columns can
be mapped during import.

| Column | Required | Description |
| --- | --- | --- |
| `front` | yes | Word or phrase in the language you study |
| `back` | yes | Translation; multiple meanings separated by `;` |
| `example` | no | Example sentence in the studied language |
| `example_translation` | no | Translation of the example |
| `ipa` | no | IPA transcription, e.g. `/teɪk ɒf/` |
| `tags` | no | Tags separated by spaces or `;` |
| `notes` | no | Free-form notes (grammar, gender, aspect, mnemonics) |

```csv
front,back,example,example_translation,ipa,tags,notes
to take off,взлетать; снимать (одежду),The plane took off at 6 am.,Самолёт взлетел в 6 утра.,/teɪk ɒf/,travel phrasal-verb,took/taken
```

Header names are recognized case-insensitively (a first row with at least two of them is treated as a header):

| Field | Recognized headers |
| --- | --- |
| `front` | front, word, term, слово, термин |
| `back` | back, translation, meaning, перевод, значение |
| `example` | example, sentence, пример |
| `example_translation` | example_translation, example translation, перевод примера |
| `ipa` | ipa, transcription, транскрипция |
| `tags` | tags, tag, теги, тег |
| `notes` | notes, note, comment, заметки, комментарий |

Without a header row, column 1 is `front`, column 2 is `back` and the other columns are ignored until mapped.

## Deployment

One binary contains the API and the PWA. On the VPS it runs under systemd behind Caddy (automatic HTTPS), with
the SQLite database continuously replicated to S3-compatible storage by Litestream. See
[`docs/architecture.md`](docs/architecture.md#deployment).

## Documentation

- [UI/UX](docs/ui_ux.md)
- [Use cases](docs/use_cases.md)
- [Tech stack](docs/tech_stack.md)
- [Architecture](docs/architecture.md)
- [Development plan](docs/plan.md)
- [Implementation task prompts](dev/impl/00-overview.md)
- [Guidance for Claude Code](CLAUDE.md)

## License

Private project. License to be decided.
