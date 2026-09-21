# P3-T06 — Phase 3 acceptance

## Context

P3-T01…T05 implemented server audio (Azure TTS, Wikimedia Commons, storage and serving), client playback with
caching and prefetch, and AI enrichment on server and client. This task verifies the Phase 3 acceptance
criteria end to end — on the deployed server and a real iPhone — fixes any gaps found, and updates the project
status. It adds no features.

## Read first

- `CLAUDE.md` (always; Definition of done, iOS gotchas)
- `docs/plan.md` Phase 3 (all checkboxes and **Acceptance**)
- `dev/impl/phase-03-audio-ai/00-phase-overview.md` (added criteria)
- `docs/architecture.md` §4.5, §7, §8, §10, §15 (OGG decision recorded)
- `docs/use_cases.md` UC-09, UC-12, UC-13

## Scope

From `docs/plan.md` Phase 3 **Acceptance**:

- A homograph and a Polish word with diacritics get correct audio on the iPhone, offline after the first play;
  adding a word with AI takes two taps.

Plus the added criteria from the phase overview (feature flags, cross-device audio, all checks green).

## Out of scope

- New features or refactors. Anything larger than a small fix becomes a question to the owner or a new
  checkbox in `docs/plan.md`.
- Phase 4 items (modes, statistics, reminders).

## Implementation steps

1. **Automated checks.** Run `just lint`, `just test`, `just e2e`. → verify: all green; fix failures.
2. **Plan consistency.** Every Phase 3 checkbox in `docs/plan.md` is ticked and implemented; the OGG decision is
   recorded in `architecture.md` §7/§15; `server/.env.example` lists `ANNETTE_AZURE_TTS_KEY`,
   `ANNETTE_AZURE_TTS_REGION`, `ANNETTE_COMMONS_ENABLED`, `ANTHROPIC_API_KEY`, `ANNETTE_LLM_MODEL`,
   `ANNETTE_ENRICH_DAILY_LIMIT`. → verify: `grep` the files.
3. **Feature flags.** Locally start the server without keys → `GET /api/meta` shows `tts`, `enrich` false and the
   UI hides Generate audio / Fill with AI; with keys → true and visible. → verify: manual check in WebKit.
4. **Deploy.** Add the new variables to `/etc/annette-cards/env` on the VPS (document in `deploy/README.md` if
   missing), `just release`, `just deploy`. → verify: `/api/meta` on the public URL shows enabled features.
5. **iPhone — homograph.** In the installed PWA, create "read" (past tense) with IPA `/rɛd/`, tap **Generate
   audio**, play: pronounced "red". → verify: by ear.
6. **iPhone — Polish.** Card "żółw" in a `pl-PL` deck: **Find recording** (or Generate audio if none is found);
   play; attribution shown for a recording. → verify: by ear; attribution visible.
7. **Offline after first play.** Enable airplane mode, reopen the app, play both words in card view and in a
   study session. → verify: MP3 audio plays (not the system voice).
8. **Cross-device.** On the laptop, after sync, both cards have audio and play; remove audio on one device →
   the other falls back to the system voice after sync. → verify: manual.
9. **Two-tap AI add.** On the iPhone: floating "+" → type a new word → Enter → **Save**. Card saved with
   suggested translation/example. Count taps (excluding typing): "+" and Save (Enter is the keyboard's return).
   → verify: manual; if more taps are needed, fix or ask.
10. **Quota and errors.** Temporarily set `ANNETTE_ENRICH_DAILY_LIMIT=1` locally → second request shows
    "Daily AI limit reached, try tomorrow" in RU and EN. → verify: manual.
11. **Status.** Update the README status line to "Phase 3 complete"; tick nothing that is not verified.

## Tests

No new feature tests. Add a regression test for every bug fixed during this task (unit, router or Playwright
WebKit, whichever reproduces it).

## Invariants to respect

- All CLAUDE.md invariants; in particular secrets only on the server (check the built JS bundle does not contain
  any key: `grep -r "ANTHROPIC\|AZURE" web/dist` returns nothing sensitive).
- Offline-first behavior unchanged for all Phase 1 features.

## Docs to update

- `README.md`: status line; feature list if wording no longer matches.
- `deploy/README.md`: new env variables for the VPS.
- `docs/plan.md`: confirm all Phase 3 checkboxes are ticked; note any follow-ups as new unchecked items.
- Any doc touched by fixes made in this task.

## Definition of done

- [ ] All acceptance criteria verified on the deployed server and a real iPhone
- [ ] `just lint`, `just test`, `just e2e` (WebKit) green
- [ ] Works offline in WebKit and on the iPhone (cached audio)
- [ ] Docs updated as listed above
- [ ] Committed: `chore: phase 3 acceptance`

## If unclear

If anything in this task is ambiguous or conflicts with the docs, stop and ask before implementing.
