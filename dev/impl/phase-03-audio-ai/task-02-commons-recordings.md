# P3-T02 — Commons recordings

## Context

P3-T01 built the audio vertical: `audio_assets`, `GET /api/audio/{id}`, `POST/DELETE /api/cards/{id}/audio`
with `source: "tts"`, card updates that bump `server_seq`, rate limiting and the `tts` feature flag. Synthetic
voices are good, but native-speaker recordings are better for tricky words. Wikimedia Commons hosts many
pronunciation files for English and Polish (usually OGG Vorbis, CC BY-SA). This task adds `source: "commons"`
and resolves the open question from `architecture.md` §15: can iOS Safari play these files, and if not, how do
we deliver a Safari-playable format?

## Read first

- `CLAUDE.md` (always)
- `docs/architecture.md` §5.3 (audio endpoints), §5.4 (`audio_assets.source`, `mime`, `attribution`), §7 step 2,
  §10 (`ANNETTE_COMMONS_ENABLED`), §15 (first open question)
- `docs/use_cases.md` UC-13 (alternative 3a)
- `docs/tech_stack.md` → External services (Wikimedia Commons / Wiktionary API), `reqwest`
- Code from P3-T01: `server/src/audio/` (`store.rs`, `service.rs`, `tts.rs`)

## Scope

From `docs/plan.md` §3.1:

- [ ] Wikimedia Commons lookup for EN and PL pronunciations with attribution
- [ ] Verify OGG playback on iOS Safari; if unsupported, add transcoding to MP3/AAC (decision recorded in
      `architecture.md`)

## Out of scope

- Client UI ("Find recording" button, attribution display) → P3-T03.
- Other languages than EN and PL (the lookup must fail cleanly with `not_found` for them).
- Choosing between several recordings in the UI — the server picks the best match.

## Implementation steps

1. **Decision step — OGG on iOS Safari (do this first).**
   a. Take two real Commons pronunciation files (e.g. `En-uk-read.ogg` and a Polish `Pl-żółw.ogg` or similar).
   b. Check in the Playwright WebKit project and on a real iPhone (installed PWA) whether
      `new Audio(url).play()` works for: the original OGG, and the MP3 derivative Wikimedia generates
      (`prop=videoinfo&viprop=derivatives` returns transcoded URLs, including `…ogg.mp3` where available).
   c. Pick one option, in this order of preference:
      - **A.** Use Wikimedia's MP3 derivative (no runtime dependency) — preferred if derivatives exist for the
        tested files.
      - **B.** Store the original OGG if iOS plays it on all target iOS versions (stored `mime` = `audio/ogg`).
      - **C.** Transcode on the server (ffmpeg runtime dependency, or a pure-Rust decoder + encoder).
   d. Stop and report the findings to the owner before implementing option C (it adds a runtime dependency on
      the VPS).
   → verify: decision and evidence (iOS version, tested URLs, result) written into `architecture.md` §7 and §15.
2. **Config and flag.** `ANNETTE_COMMONS_ENABLED` (default `true`) in `config.rs`; `features.commons` in
   `GET /api/meta`; add it to `server/.env.example`. → verify: router test for `/api/meta` with the flag off.
3. **Lookup module** `server/src/audio/commons.rs` behind a small trait so tests use a fake:
   ```rust
   #[async_trait] pub trait RecordingSource: Send + Sync {
       async fn find(&self, word: &str, lang: &str) -> Result<Option<Recording>, CommonsError>;
   }
   pub struct Recording { pub bytes: Vec<u8>, pub mime: String, pub attribution: String, pub file_page: String }
   ```
   `WikimediaCommons` implementation with `reqwest` (10 s timeout, `User-Agent: annette-cards/<version>
   (<contact>)` per Wikimedia policy):
   - candidate file names from language: `en-GB` → `En-uk-{word}.ogg`, `En-gb-{word}.ogg`; `en-US` →
     `En-us-{word}.ogg`; any `en*` falls back to the other English variant; `pl-PL` → `Pl-{word}.ogg`;
   - query `https://commons.wikimedia.org/w/api.php?action=query&titles=File:…&prop=imageinfo|videoinfo`
     `&iiprop=url|mime|extmetadata&viprop=derivatives&format=json` for all candidates in one request;
   - optionally fall back to `list=search&srnamespace=6` restricted to the language prefix;
   - attribution string: `"{Artist} · {LicenseShortName} · {file page URL}"` from `extmetadata` (strip HTML).
   Keep the parsing in a pure function `parse_file_info(json) -> Option<FileInfo>` for tests.
   → verify: unit tests on recorded JSON fixtures in `server/tests/fixtures/commons/`.
4. **Format handling** per the decision in step 1 (download derivative / original / transcode) inside
   `WikimediaCommons::find`; the stored `mime` must be what Safari plays. → verify: unit test that the chosen
   URL/mime is selected from a fixture with derivatives.
5. **Attach.** In `service.rs`, `source: "commons"` → `find(front, deck.target_lang)`; `None` → 404
   `not_found`; else same transaction as TTS: insert `audio_assets` (`source='commons'`, `attribution`), update
   card `audio_id`, `updated_at`, `updated_by='server'`, `server_seq`. Response
   `{ "audio_id": "...", "attribution": "..." }`. Disabled → 409 `commons_disabled`. Rate limit shared with TTS.
   → verify: `#[sqlx::test]` with a fake source.
6. **Optional manual smoke (real network).** Find recordings for "read" (en-GB) and "żółw" (pl-PL) on a local
   server, download `GET /api/audio/{id}`, play in Safari.

## Tests

- `parse_file_info` on fixtures: file with derivatives, file without derivatives, missing file (`"missing"`
  key), HTML in `Artist` stripped.
- Candidate names: `en-GB` + `to take off` → spaces become `_`/kept per MediaWiki title rules; Polish
  diacritics preserved; unsupported language → `Ok(None)` without an HTTP call.
- Attach with fake source returning a recording → asset stored with `attribution`, card `server_seq` bumped,
  response contains attribution.
- Fake returns `None` → 404 `not_found`, card unchanged.
- Fake returns error → 502 `provider_error`.
- `ANNETTE_COMMONS_ENABLED=false` → 409 `commons_disabled`; `/api/meta` `commons: false`.
- Other user's card → 404 `not_found`.

## Invariants to respect

- Every query filters by `user_id`; ownership of the card validated.
- Server card edits bump `updated_at` and `server_seq`.
- Attribution (CC BY-SA) is always stored for Commons audio and exposed via `X-Audio-Attribution`.
- No automated test calls Wikimedia.

## Rust learning notes (server tasks only)

Explain briefly in the final task summary:
- **Parsing untyped JSON** with `serde_json::Value` vs typed `#[derive(Deserialize)]` structs with
  `Option` fields and `#[serde(default)]` — why typed structs are used here.
- **URL building** with `reqwest`'s `.query(&[...])` instead of manual string formatting (encoding of
  `ż`, spaces).
- A second implementation of the same trait pattern (`RecordingSource`) and test fakes.

## Docs to update

- `docs/architecture.md` §7 step 2 (lookup strategy, format decision, attribution format) and §15 (mark the
  OGG question as resolved with the decision and date); §5.3 error codes (`commons_disabled`).
- `docs/tech_stack.md`: if option C is chosen, add the transcoder dependency (and VPS package) with rationale;
  update the Wikimedia row either way.
- `deploy/README.md`: only if option C adds a system package.
- `server/.env.example`: `ANNETTE_COMMONS_ENABLED`.
- `docs/plan.md`: tick the two checkboxes above.

## Definition of done

- [ ] OGG decision made, evidence recorded, owner informed (and approved if option C)
- [ ] All scope items implemented
- [ ] Tests written and passing: `just test`
- [ ] `just lint` clean; `just sqlx-prepare` run if queries changed; `just gen-api` if DTOs changed
- [ ] Docs updated as listed above; plan.md checkboxes ticked
- [ ] Committed: `feat(server): Wikimedia Commons pronunciation recordings`

## If unclear

If anything in this task is ambiguous or conflicts with the docs, stop and ask before implementing.
