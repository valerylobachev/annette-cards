# P3-T03 — Client audio

## Context

The server can now attach generated (Azure TTS, P3-T01) or recorded (Wikimedia Commons, P3-T02) audio to a
card: `POST /api/cards/{id}/audio`, `DELETE /api/cards/{id}/audio`, `GET /api/audio/{id}` (immutable, with
`X-Audio-Source` / `X-Audio-Attribution` headers). The card's `audio_id` reaches every device through sync.
On the client, pronunciation still always uses `speechSynthesis` (Phase 1 speech service). This task adds the
Pronunciation section of the card view, the layered playback chain (cached MP3 → download and cache → system
voice), the Workbox audio cache, optional prefetch after sync, and storage controls in Settings.

## Read first

- `CLAUDE.md` (always; offline-first invariant, iOS gotchas)
- `docs/architecture.md` §4.1 (platform services in `src/lib`), §4.2 (device-local prefs in `meta`, incl. audio
  prefetch flag), §4.5 (playback flowchart, prefetch, `audio-v1`), §4.7 (runtime caching row), §5.3 (audio
  endpoints, `/api/meta`)
- `docs/ui_ux.md` S-07 (Pronunciation section), S-14 (Data: storage usage, Clear cached audio; About:
  licenses/attributions), §4 Offline hint, §7 (Server feature offline)
- `docs/use_cases.md` UC-12, UC-13, UC-18 (uncached audio offline)
- `docs/tech_stack.md` → `vite-plugin-pwa` (Workbox), TanStack Query, orval

## Scope

From `docs/plan.md` §3.2:

- [ ] Card view pronunciation section: generate, find recording, remove, attribution display
- [ ] Playback chain: cached MP3 → download+cache → system voice fallback
- [ ] Workbox runtime cache for `/api/audio/*`; optional prefetch for active decks after sync
- [ ] "Clear cached audio" and storage usage in Settings

(added) Settings → About lists Wikimedia attributions of cached recordings (read from the
`X-Audio-Attribution` header of entries in `audio-v1`).

## Out of scope

- Server changes (done in P3-T01/T02). If an API gap is found, stop and ask.
- AI enrichment UI → P3-T05.
- Voice selection for system voices (Phase 1, S-16) — reuse, do not change.

## Implementation steps

1. **Audio cache service** `web/src/lib/audio/audioCache.ts`: constant `AUDIO_CACHE = 'audio-v1'`;
   `audioUrl(id)` → `/api/audio/${id}`; `getCached(id): Promise<Response | undefined>`;
   `download(id): Promise<Response>` (fetch with `credentials: 'same-origin'`, `put` a clone into the cache on
   200); `clearAudioCache()`; `cachedAudioInfo(): Promise<{count, attributions: string[]}>`.
   → verify: Vitest with a fake `caches` implementation.
2. **Playback chain** `web/src/lib/audio/playCard.ts`:
   `playCardAudio(card, deck, opts): Promise<'mp3' | 'speech'>` implementing §4.5: `card.audio_id` →
   cached? play; else online → download+cache → play; else (offline / fetch error / play() rejected) →
   existing speech service (`lang = deck.target_lang`, device voice). Play via one reused `HTMLAudioElement`
   with an object URL from the blob (revoke on end). Replace direct speech calls in the study card, card view,
   editor preview and deck list speaker buttons with this function (examples still use speech).
   → verify: unit tests below; manual: speaker button plays MP3 for a card with audio.
3. **Workbox runtime cache.** In `vite.config.ts` (`vite-plugin-pwa`): `runtimeCaching` entry for
   `/^\/api\/audio\//` → `CacheFirst`, `cacheName: 'audio-v1'`, `expiration.maxEntries: 5000`,
   `cacheableResponse.statuses: [200]`. Keep other `/api/*` `NetworkOnly`. The explicit `cache.put` in step 1
   and the SW rule use the same cache name. → verify: `just build`; generated SW contains the rule.
4. **Feature flags.** A `useServerFeatures()` hook (TanStack Query on `GET /api/meta`, last value persisted in
   `meta` so it is known offline). → verify: hook test with mocked client.
5. **Pronunciation section (S-07)** `web/src/features/cards/PronunciationSection.tsx`:
   - current source: "System voice" (no `audio_id`), "Generated" or "Recording" (from the
     `X-Audio-Source` header of the cached/downloaded response) + attribution text for Commons;
   - buttons **Generate audio** (`source: 'tts'`), **Find recording** (`source: 'commons'`), **Remove audio**;
     shown only when the feature is enabled and the user is signed in; offline → disabled with the Offline hint
     ("Available online");
   - on success: write `audio_id` into the local card via a repository function
     `applyServerAudio(cardId, audioId | null)` that does **not** create an outbox entry (the server already
     changed and versioned the card), pre-cache the new clip, play it once, then trigger a sync;
   - errors mapped to `errors.<code>`: `tts_disabled`, `commons_disabled`, `not_found` ("No recording found"),
     `provider_error`, `rate_limited`.
   All strings in `en.json` and `ru.json`. → verify: component tests with mocked API.
6. **Prefetch after sync.** Device-local flag `audio_prefetch` in `meta` (default off) with a toggle in
   Settings → Audio. After a successful sync (hook from the sync engine), download missing clips for cards with
   `audio_id` in non-archived, non-deleted decks, max 2 concurrent, stop when offline. → verify: unit test of
   the "which ids to fetch" function; manual: toggle on, sync, check Cache Storage in devtools.
7. **Settings → Data.** Storage usage from `navigator.storage.estimate()` (usage/quota, formatted via `Intl`),
   cached clip count, **Clear cached audio** with confirm sheet → `clearAudioCache()`. **About**: list of
   attributions from `cachedAudioInfo()`. → verify: component test; manual in WebKit.

## Tests

- Vitest `playCardAudio`: no `audio_id` → speech; cached → mp3 without fetch; not cached + online → fetch,
  cache put, mp3; not cached + offline → speech; fetch 404 → speech; `play()` rejection → speech.
- `audioCache`: `download` only caches 200 responses; `clearAudioCache` empties; attributions decoded from
  percent-encoded header.
- `applyServerAudio` (fake-indexeddb): updates `audio_id`, adds no outbox entry.
- `PronunciationSection`: buttons hidden when features disabled; disabled offline with hint; success path
  calls `applyServerAudio` and triggers sync; `not_found` shows localized message.
- Playwright (WebKit): card with audio (mocked `/api/audio/*` route) → play once online → go offline
  (`context.setOffline(true)`) → play again succeeds from cache; card without cached audio offline falls back
  to speech (assert via a spy on the speech service exposed in test mode).

## Invariants to respect

- Offline-first: UI never reads user data from the API; the card's `audio_id` comes from Dexie. The audio POST
  is a server feature call, like enrich.
- No hardcoded UI strings; errors localized from codes.
- iOS: audio playback only after a user gesture (speaker tap or the study Start gate).
- Server-edited field `audio_id` is applied locally without an outbox entry to avoid a redundant push that could
  race with the server version.

## Docs to update

- `docs/architecture.md` §4.5: `applyServerAudio` without outbox, source/attribution via response headers,
  prefetch concurrency; §4.2: `audio_prefetch` and cached `/api/meta` in `meta`.
- `docs/ui_ux.md` S-14: prefetch toggle location, attributions list in About.
- `docs/plan.md`: tick the four checkboxes above.

## Definition of done

- [ ] All scope items implemented
- [ ] Tests written and passing: `just test` and `just e2e` (WebKit)
- [ ] `just lint` clean
- [ ] Works offline in WebKit (cached audio plays; uncached falls back to speech)
- [ ] Docs updated as listed above; plan.md checkboxes ticked
- [ ] Committed: `feat(web): server audio playback, caching and pronunciation controls`

## If unclear

If anything in this task is ambiguous or conflicts with the docs, stop and ask before implementing.
