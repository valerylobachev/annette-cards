# Phase 3 — Audio and AI

**Goal:** correct pronunciation for any word and near-instant word entry.
**Use cases:** UC-09 (Add a word with AI enrichment), UC-13 (Fix pronunciation with generated audio or a
recording); extends UC-06 (Quick add) and UC-12 (Listen to pronunciation).
**Screens:** S-07 (Pronunciation section), S-08 ("Fill with AI"), S-09 (Quick add with suggestions),
S-14 (Data: storage usage, Clear cached audio; About: attributions).
**Prerequisites:**

- Phase 2 complete: accounts, sync (push/pull with `server_seq`), the deployed server on the VPS, the orval
  client with TanStack Query, the Offline hint component and the sync engine's "sync finished" hook.
- **Azure AI Speech** resource: key and region → `ANNETTE_AZURE_TTS_KEY`, `ANNETTE_AZURE_TTS_REGION`.
- **Wikimedia**: no key; `ANNETTE_COMMONS_ENABLED=true` (default). A descriptive `User-Agent` with a contact
  address is required by the Wikimedia API policy.
- **Anthropic API** key → `ANTHROPIC_API_KEY`; model name → `ANNETTE_LLM_MODEL`;
  quota → `ANNETTE_ENRICH_DAILY_LIMIT` (default 200).
- A real iPhone (iOS Safari, installed PWA) for the OGG playback check and the phase acceptance.

All external services are optional: without keys the server reports the feature as disabled in `GET /api/meta`
and the client hides the corresponding buttons. No automated test may call a real external API.

## Tasks

| # | File | Scope (plan.md section) | Depends on | Est. size |
| --- | --- | --- | --- | --- |
| P3-T01 | [task-01-tts-audio-server.md](task-01-tts-audio-server.md) | 3.1a — `audio_assets`, `GET /api/audio/{id}`, `TtsProvider` + Azure, card update, rate limit, feature flags | Phase 2 | L |
| P3-T02 | [task-02-commons-recordings.md](task-02-commons-recordings.md) | 3.1b — Wikimedia Commons lookup, OGG decision | P3-T01 | M |
| P3-T03 | [task-03-client-audio.md](task-03-client-audio.md) | 3.2 — Pronunciation section, playback chain, audio cache, prefetch, storage | P3-T01, P3-T02 | L |
| P3-T04 | [task-04-enrich-server.md](task-04-enrich-server.md) | 3.3a — `Enricher` + Anthropic, quota, prompt tuning | Phase 2 | M |
| P3-T05 | [task-05-enrich-client.md](task-05-enrich-client.md) | 3.3b — "Fill with AI", Quick add suggestions | P3-T04 | M |
| P3-T06 | [task-06-phase-acceptance.md](task-06-phase-acceptance.md) | Phase 3 acceptance | P3-T01…T05 | S |

## Execution notes

- **Why 3.1 is split (T01/T02).** Section 3.1 has five server items including two independent providers and an
  open research question (OGG playback on iOS). T01 builds the whole audio vertical with Azure TTS (storage,
  serving, card update, rate limit, flags); T02 adds the second provider on top of the same plumbing and
  resolves the format question. Each ends in a testable state.
- **Why 3.3 is split (T04/T05).** Section 3.3 spans server (trait, provider, quota, prompt) and client (editor
  and quick add UI). The server part is finished and tested with fakes first; `just gen-api` then gives the
  client a typed `enrich` call.
- **Server edits a synced entity.** Attaching or removing audio changes `cards.audio_id` on the server. The
  server must set `updated_at = now`, `updated_by = "server"` and a fresh `server_seq`, otherwise other devices
  never receive the change and a stale client push could overwrite it (LWW, `architecture.md` §6.1).
- **Attribution on other devices.** Only `audio_id` is synced with the card. T01 sends `X-Audio-Source` and
  `X-Audio-Attribution` response headers with `GET /api/audio/{id}` so that a cached response carries its
  attribution offline (added; documented in `architecture.md` §5.3).
- **Secrets stay on the server.** The client never talks to Azure, Wikimedia or Anthropic directly.
- **iOS gesture rule.** Playing an `HTMLAudioElement` must happen inside a user gesture handler or after the
  study start gate; reuse the gesture unlock from Phase 1.
- Every new server env variable goes into `server/.env.example` and `architecture.md` §10.

## Phase acceptance

From `docs/plan.md`:

> A homograph and a Polish word with diacritics get correct audio on the iPhone, offline after the first play;
> adding a word with AI takes two taps.

Added criteria:

- `GET /api/meta` reports `tts`, `commons`, `enrich` correctly with and without keys; the UI hides disabled
  features.
- Audio attached on one device plays on a second device after sync, including offline after its first play.
- `just lint`, `just test` and `just e2e` (WebKit) pass; no test calls a real external API.
