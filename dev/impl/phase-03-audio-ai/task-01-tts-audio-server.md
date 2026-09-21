# P3-T01 — TTS audio (server)

## Context

Phases 0–2 are done: the Rust server has auth (`CurrentUser` extractor), sync push/pull with `server_seq`
allocation, and is deployed. Cards currently rely on the device's system voice, which mispronounces homographs
and sometimes has no voice at all. This task builds the server-side audio vertical: storing MP3 clips in
SQLite, serving them with immutable caching, generating them with Azure AI Speech (with an IPA hint), attaching
them to a card so that sync delivers the change to every device, rate limiting, and advertising the feature in
`/api/meta`. The Wikimedia provider (P3-T02) and the client UI (P3-T03) build on this.

## Read first

- `CLAUDE.md` (always)
- `docs/architecture.md` §5.1 (`audio/`), §5.2, §5.3 (audio endpoints, `/api/meta`), §5.4 (`cards`,
  `audio_assets`), §6.1 (LWW), §7 (audio pipeline), §9, §10, §14 ADR-6
- `docs/use_cases.md` UC-13
- `docs/ui_ux.md` S-07 (Pronunciation section — for the API shape the client will need)
- `docs/tech_stack.md` → `reqwest` (rustls), `tower_governor`, `uuid` v7, External services (Azure)

## Scope

From `docs/plan.md` §3.1:

- [ ] `audio_assets` migration; `GET /api/audio/{id}` with immutable caching headers
- [ ] `TtsProvider` trait and Azure implementation (SSML, voice per language, IPA `<phoneme>`)
- [ ] Card update on audio attach/remove (bumps `server_seq`), rate limiting, feature flags in `/api/meta`

(added) `GET /api/audio/{id}` also returns `X-Audio-Source` and `X-Audio-Attribution` (percent-encoded) headers
so a cached clip carries its attribution to devices that only received `audio_id` via sync.

## Out of scope

- Wikimedia Commons lookup and the OGG question → P3-T02 (but design `source` handling so it only needs a new
  branch).
- Any client UI or caching → P3-T03.
- Purging orphaned `audio_assets` rows → P4-T07. Removing audio from a card does **not** delete the asset.

## Implementation steps

1. **Migration.** `just db-new audio_assets` creating `audio_assets` exactly as in `architecture.md` §5.4
   plus `CREATE INDEX idx_audio_card ON audio_assets(card_id)`. → verify: server starts, migration applied;
   `just sqlx-prepare` succeeds.
2. **Config.** Add to `config.rs`: `azure_tts_key: Option<String>`, `azure_tts_region: Option<String>`
   (`ANNETTE_AZURE_TTS_KEY`, `ANNETTE_AZURE_TTS_REGION`). TTS is enabled only if both are set. Add both to
   `server/.env.example` (empty values). → verify: unit test that config with/without keys yields
   `tts_enabled()` true/false.
3. **Storage module** `server/src/audio/store.rs`: `insert_asset(...) -> Result<String, AppError>` (UUIDv7 id,
   `created_at` ms) and `get_asset(pool, user_id, id) -> Result<Option<AudioAsset>, AppError>`; every query
   filters by `user_id`. → verify: `#[sqlx::test]` insert + get; get with another user's id returns `None`.
4. **Serving.** `GET /api/audio/{id}` (auth required): 404 `not_found` if missing or not owned; else bytes with
   `Content-Type: <mime>`, `Cache-Control: private, max-age=31536000, immutable`, `X-Audio-Source`,
   `X-Audio-Attribution` (only when set). → verify: router test with `oneshot` checks status, headers, body.
5. **Provider trait** `server/src/audio/tts.rs`:
   ```rust
   pub struct TtsRequest { pub text: String, pub lang: String, pub ipa: Option<String>, pub voice: Option<String> }
   pub struct TtsAudio { pub bytes: Vec<u8>, pub mime: String, pub voice: String }
   #[async_trait] pub trait TtsProvider: Send + Sync { async fn synthesize(&self, req: &TtsRequest) -> Result<TtsAudio, TtsError>; }
   ```
   Store it in `AppState` as `Option<Arc<dyn TtsProvider>>` (`None` = disabled). → verify: compiles; clippy clean.
6. **SSML builder** (pure function `build_ssml(req, voice) -> String`): `<speak version="1.0"
   xml:lang="{lang}"><voice name="{voice}">…</voice></speak>`; XML-escape the text; if `ipa` is set, strip
   surrounding `/…/` or `[…]` and wrap the text in `<phoneme alphabet="ipa" ph="…">`. Voice per language from a
   constant map (e.g. `en-GB` → `en-GB-SoniaNeural`, `en-US` → `en-US-JennyNeural`, `pl-PL` →
   `pl-PL-ZofiaNeural`); unknown language → `TtsError::UnsupportedLanguage`. → verify: unit tests below.
7. **Azure implementation** `AzureTts` using a shared `reqwest::Client` (rustls, 10 s timeout): `POST
   https://{region}.tts.speech.microsoft.com/cognitiveservices/v1` with headers `Ocp-Apim-Subscription-Key`,
   `Content-Type: application/ssml+xml`, `X-Microsoft-OutputFormat: audio-24khz-48kbitrate-mono-mp3`,
   `User-Agent: annette-cards`. Non-2xx or network error → `provider_error`. → verify: optional manual smoke
   (step 11).
8. **Attach service** `server/src/audio/service.rs`: `attach_tts(state, user, card_id, voice)`:
   load card by `id` **and** `user_id` (else 404 `not_found`; deleted card → `not_found`); call provider with
   `front`, deck `target_lang`, `ipa`; in **one transaction** insert the asset (`source='azure'`,
   `mime='audio/mpeg'`) and update the card: `audio_id`, `updated_at = now`, `updated_by = 'server'`,
   `server_seq = <next from sync_seq>` (reuse the allocation function from `sync/`). Return
   `{ "audio_id": "...", "attribution": null }`. → verify: `#[sqlx::test]` with `FakeTts`.
9. **Endpoints.** `POST /api/cards/{id}/audio` body `{ "source": "tts" | "commons", "voice"?: string }`
   (`commons` returns 400 `not_implemented` until P3-T02); TTS disabled → 409 `tts_disabled`.
   `DELETE /api/cards/{id}/audio` → sets `audio_id = NULL` with the same `updated_at`/`updated_by`/`server_seq`
   bump, returns 204. Both registered in utoipa with DTOs (`AttachAudioRequest`, `AttachAudioResponse`).
   → verify: router tests; `just gen-api` regenerates the client without errors.
10. **Rate limit and flags.** 60 requests/hour **per user** for `POST /api/cards/{id}/audio` (`tower_governor`
    with a key extractor on the user id from the session, or a small in-memory per-user counter if the
    extractor gets complicated — keep it simple) → 429 `rate_limited`. `GET /api/meta` `features.tts` reflects
    config. → verify: router test sends 61 requests with a fake provider and gets 429 on the last one.
11. **Optional manual smoke (real key).** With keys in `server/.env`, attach TTS audio to "read" with IPA
    `/rɛd/` and to "żółw"; download `GET /api/audio/{id}` and listen. Not part of automated tests.

## Tests

- `build_ssml`: plain text; text with `&`, `<`, `"` escaped; IPA `/teɪk ɒf/` → `ph="teɪk ɒf"`; unknown
  language → error; explicit `voice` overrides the map.
- `#[sqlx::test]` attach with `FakeTts` (returns fixed bytes): asset row exists with `user_id`; card
  `audio_id`, `updated_by = 'server'`, `server_seq` greater than before; a subsequent pull from another device
  cursor includes the card.
- Attach to another user's card → 404 `not_found`; nothing written.
- Provider failure → `provider_error`, card unchanged (transaction not started before provider call).
- `DELETE` clears `audio_id` and bumps `server_seq`; asset row still exists.
- `GET /api/audio/{id}`: owner gets 200 + headers; other user 404; unauthenticated 401.
- TTS disabled (`AppState` provider `None`) → 409 `tts_disabled`; `/api/meta` shows `tts: false`.
- Rate limit: 61st request within an hour → 429 `rate_limited`.

## Invariants to respect

- Every query touching user data filters by `user_id`; parent ownership (card → user) validated.
- Server-side edits of synced entities bump `updated_at` and `server_seq` so LWW and pull work.
- Timestamps are `i64` ms; IDs UUIDv7; error responses are codes only (no user-visible strings).
- Secrets (Azure key) never leave the server and are never logged.

## Rust learning notes (server tasks only)

Explain briefly in the final task summary:
- **Trait objects and `Arc<dyn TtsProvider>`**: dynamic dispatch so tests can inject `FakeTts`; why
  `Send + Sync` is required inside `AppState`.
- **Async functions in traits**: native `async fn` in traits is not usable with `dyn`; hence the
  `async-trait` crate (add it and mention it in `docs/tech_stack.md`).
- **`reqwest`**: shared client, timeouts, mapping errors into `AppError` with `?` and `From`.
- **Building XML safely**: escaping text instead of string concatenation of raw input.

## Docs to update

- `docs/architecture.md` §5.3: `POST /api/cards/{id}/audio` body, `X-Audio-Source`/`X-Audio-Attribution`
  headers, error codes (`tts_disabled`, `not_found`, `provider_error`, `rate_limited`); §7: `updated_by =
  'server'` convention for server-side card edits; §10: confirm Azure variables.
- `docs/tech_stack.md`: `async-trait` in the Server table.
- `server/.env.example`: new variables.
- `docs/plan.md`: tick the three checkboxes above.

## Definition of done

- [ ] All scope items implemented
- [ ] Tests written and passing: `just test`
- [ ] `just lint` clean; `just sqlx-prepare` run and `.sqlx/` committed
- [ ] `just gen-api` run; generated client committed
- [ ] Docs updated as listed above; plan.md checkboxes ticked
- [ ] Committed: `feat(server): audio assets and Azure TTS generation`

## If unclear

If anything in this task is ambiguous or conflicts with the docs, stop and ask before implementing.
