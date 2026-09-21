# P1-T11 — Speech

## Context

The app can manage words and run study sessions (P1-T02…P1-T10), but it is silent. Native pronunciation is a
core promise. This task builds the speech service on the Web Speech API (voice loading, best voice per locale,
explicit `lang`, rate), autoplay in study, tap-to-speak everywhere a word or example is shown, the Voices
screen (S-16) and the missing-voice warning. Server audio comes in Phase 3 (P3-T03 extends the playback chain);
design the service so that chain can be inserted in front of speech synthesis.

## Read first

- `CLAUDE.md` (always) — "iOS / Safari gotchas"
- `docs/architecture.md` §4.5 (flowchart, voice rules), §4.2 (device-local preferences in `meta`), §5.5
  (`autoplay`)
- `docs/ui_ux.md` S-11 Mode A (autoplay on front / reveal), S-16, S-07, S-08, S-06 (speaker buttons), §7 ("No
  voice for language", "Speech blocked")
- `docs/use_cases.md` UC-12, UC-22, UC-01 3a

## Scope

From `docs/plan.md` §1.6:

- [ ] Speech service: voice loading (`voiceschanged`), best-voice selection per locale, explicit `lang`, rate
- [ ] Autoplay settings (off / front / front+answer), tap-to-speak word and example
- [ ] Voices screen (S-16) with samples and iOS voice download guide
- [ ] Missing-voice warning on study start
- [ ] (added) Speaker buttons in deck detail rows, card view, card editor (next to Front) and study card

## Out of scope

- Server audio, Cache Storage, `/api/audio` (P3-T03).
- Settings screen layout (P1-T12) — add the autoplay and rate controls to a section component P1-T12 embeds.

## Implementation steps

1. `web/src/lib/speech/voices.ts`: `loadVoices(): Promise<SpeechSynthesisVoice[]>` — `getVoices()`, and if
   empty wait for `voiceschanged` (timeout 3 s). `rankVoice(v)`: Premium > Enhanced > default (detect by name
   containing "Premium"/"Enhanced" or `voiceURI` quality markers on iOS). `bestVoice(voices, lang)`: exact
   locale match (`en-GB`) first, then same language (`en-*`), highest rank. → verify: unit tests with fake
   voice lists.
2. `web/src/lib/speech/speech.ts`: `speak(text, { lang, rate?, voiceURI? })` → Promise resolved on `end`;
   cancels the current utterance; always sets `utterance.lang`; uses the device preference `meta.voice_pref
   [lang]` else `bestVoice`; rate from `meta.speech_rate` (default 1.0). `unlock()` speaks an empty utterance
   inside a user gesture. Interface `Speaker { play(card, part: 'front'|'example') }` so P3-T03 can prepend
   server audio.
3. `web/src/lib/speech/useSpeech.ts`: hook exposing `speak`, `voicesFor(lang)`, `hasVoice(lang)`.
4. Study integration (`SwipeCard` / session): Start tap calls `unlock()`; `settings.autoplay`:
   `off` → none; `front` → speak the front on show for forward direction; `front_and_answer` → also speak the
   studied word on reveal in reverse direction (answer side). Speech failure never blocks answering; if blocked
   (no gesture) the speaker icon pulses and tap plays (§7).
5. Tap-to-speak: speaker button + tapping the word speaks `front` with `deck.target_lang`; tapping the example
   speaks the example. Add to deck detail rows (P1-T04), card view, card editor (next to Front), study card.
6. Voices screen `/settings/voices` → `web/src/features/settings/VoicesPage.tsx`: per studied language (from
   non-deleted decks' `target_lang`), list voices with quality badges, sample button ("The quick brown fox
   jumps over the lazy dog." for English, "Zażółć gęślą jaźń." for Polish; samples stay in the studied
   language), select → `meta.voice_pref[lang]`; note "This choice applies to this device only"; guide
   "How to download better voices on iPhone" (Settings → Accessibility → Spoken Content → Voices); refresh on
   `visibilitychange` when returning.
7. Missing-voice warning: on study start, if `!hasVoice(deck.target_lang)` show banner "No voice for Polish
   installed — tap to see how to add one" (→ Voices guide); study continues silently.
8. Autoplay control (Off / Front / Front and answer) and speech rate slider (0.5–1.2) as
   `AudioSettingsSection.tsx` for P1-T12. Autoplay is a synced setting (`settings.autoplay`); rate is
   device-local (`meta.speech_rate`).
9. i18n keys under `speech.*`, `voices.*`.

## Tests

- Vitest: `bestVoice` prefers `en-GB` Premium over `en-GB` default over `en-US` Premium when lang is `en-GB`;
  returns `null` for `pl-PL` when no Polish voice exists.
- Vitest: `loadVoices` resolves after a simulated `voiceschanged` event.
- Vitest: autoplay decision function `shouldSpeak(autoplay, direction, side)` table test.
- Playwright (WebKit): stub `speechSynthesis` via `addInitScript`, start study with autoplay `front` → one
  `speak` call with `lang = 'en-GB'`; Voices page lists stubbed voices and persists selection across reload.

## Invariants to respect

- Device-local preferences in `meta`, never synced; `autoplay` is a synced setting via the settings repository.
- Speech first triggered by a user gesture; `lang` always explicit.
- No hardcoded UI strings (voice samples are content in the studied language, keep them in a constants file).

## Rust learning notes

n/a (web-only task).

## Docs to update

- `docs/architecture.md` §4.5: document the `Speaker` interface (extension point for P3-T03) and the quality
  ranking heuristics actually used.
- `docs/architecture.md` §5.5: confirm `autoplay` values (`off` | `front` | `front_and_answer`).
- `docs/plan.md`: tick the four §1.6 checkboxes above and the (added) item.

## Definition of done

- [ ] All scope items implemented
- [ ] Tests written and passing: `just test`, `just e2e` (WebKit)
- [ ] `just lint` clean
- [ ] Works offline in WebKit
- [ ] Docs updated as listed above; plan.md checkboxes ticked
- [ ] Committed: `feat(web): speech service, autoplay, tap-to-speak and Voices screen`

## If unclear

If anything in this task is ambiguous or conflicts with the docs, stop and ask before implementing.
