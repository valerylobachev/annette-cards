# Use Cases

This document describes how people use Annette Cards. Screen references (S-xx) point to
[`ui_ux.md`](ui_ux.md); phases refer to [`plan.md`](plan.md).

## Actors

| Actor | Description |
| --- | --- |
| **Learner** | Any user studying words. May use the app locally without an account or signed in on several devices. |
| **Admin** | The owner. A Learner with admin rights: creates invites, operates the server. |
| **System** | Background processes: sync engine (client), reminder and purge jobs (server). |

## Overview

| ID | Use case | Actor | Phase |
| --- | --- | --- | --- |
| UC-01 | First run and onboarding | Learner | 1 |
| UC-02 | Register with an invite | Learner | 2 |
| UC-03 | Sign in and sign out | Learner | 2 |
| UC-04 | First sign-in on a device with local data | Learner | 2 |
| UC-05 | Manage decks | Learner | 1 |
| UC-06 | Quick add a word | Learner | 1 |
| UC-07 | View, edit and delete a card | Learner | 1 |
| UC-08 | Daily review from Today | Learner | 1 |
| UC-09 | Add a word with AI enrichment | Learner | 3 |
| UC-10 | Import a dictionary from CSV/TSV | Learner | 1 |
| UC-11 | Swipe study session | Learner | 1 |
| UC-12 | Listen to pronunciation | Learner | 1 |
| UC-13 | Fix pronunciation with generated audio or a recording | Learner | 3 |
| UC-14 | Multiple-choice and listening modes | Learner | 4 |
| UC-15 | Typing mode | Learner | 4 |
| UC-16 | Practice difficult words | Learner | 1 |
| UC-17 | Undo the last answer | Learner | 1 |
| UC-18 | Study offline | Learner | 1 |
| UC-19 | View statistics | Learner | 4 |
| UC-20 | Sync between devices | Learner, System | 2 |
| UC-21 | Configure study settings | Learner | 1 |
| UC-22 | Choose a voice | Learner | 1 |
| UC-23 | Receive study reminders | Learner, System | 4 |
| UC-24 | Export a backup | Learner | 1 |
| UC-25 | Restore a backup | Learner | 1 (local), 2 (server) |
| UC-26 | Install the app on iPhone | Learner | 1 |
| UC-27 | Switch the UI language | Learner | 1 |
| UC-28 | Invite a user | Admin | 2 |
| UC-29 | Operate the server (create admin, back up, restore, deploy) | Admin | 2 |
| UC-30 | Optimize FSRS parameters | Learner | 4 |

---

## UC-01 First run and onboarding

**Actor:** Learner · **Screens:** S-01

**Preconditions:** App opened for the first time on this device; no local data, no session.

**Main flow:**
1. Learner opens the app; the Welcome step is shown in the language detected from the browser.
2. Learner optionally switches the UI language and taps "Get started".
3. Learner selects the studied language (e.g. English, variant en-GB) and native language (Russian).
4. Learner selects a daily goal for new words (default 15).
5. Learner chooses how to create the first deck: import (→ UC-10), add manually (→ UC-06) or empty deck.
6. System creates the deck and default settings locally, requests persistent storage.
7. On iOS Safari outside standalone mode, the install hint is shown (→ UC-26).
8. Today screen opens.

**Alternatives:**
- 2a. Learner taps "I have an account" → UC-03; after sign-in, data is pulled from the server.
- 3a. No system voice exists for the chosen language → warning with link to voice guide (→ UC-22); onboarding
  continues.

**Postconditions:** One deck, settings stored locally; the app works fully without an account.

## UC-02 Register with an invite

**Actor:** Learner · **Screens:** S-02

**Preconditions:** Learner received an invite link or code from the Admin (UC-28); device is online.

**Main flow:**
1. Learner opens the invite link (`/register?invite=CODE`) or enters the code manually.
2. Learner enters display name, email and password (≥ 10 characters).
3. Server validates the invite (exists, unused, not expired), creates the user and a session, marks the invite
   used.
4. Client stores account info and starts the first sync (→ UC-04 if local data exists, otherwise UC-20).

**Alternatives:**
- 3a. Invite invalid/expired/used → error `invite_invalid` / `invite_expired`; form stays.
- 3b. Email already registered → `email_taken`, link to sign in.

**Postconditions:** Account exists; device is signed in.

## UC-03 Sign in and sign out

**Actor:** Learner · **Screens:** S-02, S-15

**Main flow (sign in):**
1. Learner enters email and password.
2. Server verifies credentials, creates a session (cookie, 90-day sliding).
3. Client runs the first sync (UC-04 or UC-20).

**Main flow (sign out):**
1. Learner taps "Sign out" in Account & sync.
2. If the outbox has unsynced changes, the client attempts a sync; if it fails, a warning shows the count of
   unsynced changes with options "Sign out anyway" / "Cancel".
3. Server revokes the session; client clears IndexedDB and cached audio; onboarding screen opens.

**Alternatives:**
- Wrong credentials → `invalid_credentials`; after 10 attempts/min → `rate_limited`.
- "Sign out other devices" revokes all sessions except the current one.

## UC-04 First sign-in on a device with local data

**Actor:** Learner · **Screens:** S-03

**Preconditions:** Device has local decks created in local-only mode; Learner signs in or registers.

**Main flow:**
1. Client asks the server for account data counts (first pull page).
2. Server account empty → client pushes all local data, then pulls. Done.
3. Both sides have data → S-03 shows counts and options.
4. Learner chooses **Merge**: client pushes all local rows, then pulls everything; both datasets coexist.

**Alternatives:**
- 4a. **Use account data**: confirm, client clears local data and pulls from the server.
- 4b. **Cancel**: client signs out again, local data untouched.

**Postconditions:** Local and server data are consistent; the sync cursor is stored.

## UC-05 Manage decks

**Actor:** Learner · **Screens:** S-05, S-06

**Main flow (create):**
1. Learner taps "+" on Decks.
2. Enters name, studied language with variant, native language, directions (Forward / Reverse / Both), optional
   daily new-card override.
3. System creates the deck; it appears in the list.

**Other operations:**
- **Rename / settings:** changes apply immediately; changing directions creates missing card states (new) or
  hides states of the disabled direction (kept for later).
- **Archive:** deck disappears from Today and study queues; data kept; can be restored.
- **Delete:** confirm with card count; deck and its cards are soft-deleted; snackbar Undo for 10 s.

**Postconditions:** Changes stored locally and queued for sync.

## UC-06 Quick add a word

**Actor:** Learner · **Screens:** S-09 (or S-08 for full form)

**Main flow:**
1. Learner taps the floating "+".
2. Deck selector shows the last used deck; Learner types the word and presses Enter.
3. Offline or AI disabled: a "Translation" field appears; Learner types it and saves.
4. System checks duplicates, creates the card with new states for active directions.
5. Snackbar "Added · Edit"; the field is cleared for the next word.

**Alternatives:**
- 3a. Online with AI enabled → UC-09 suggestions; Learner accepts with one tap.
- 4a. Duplicate in the deck → warning with "Add anyway" / "Open existing".

## UC-07 View, edit and delete a card

**Actor:** Learner · **Screens:** S-07, S-08

**Main flow:**
1. Learner finds a card via deck search or taps a word in the session summary.
2. Card view shows all fields, pronunciation source and progress per direction.
3. Learner taps Edit, changes fields and saves; `updated_at` changes and the card is queued for sync.

**Alternatives:**
- **Delete:** confirm; soft delete; Undo snackbar.
- **Reset progress:** confirm; states return to New; review history is kept.
- **Move to another deck:** via deck picker in the editor or multi-select in the deck list.

## UC-08 Daily review from Today

**Actor:** Learner · **Screens:** S-04, S-11, S-12

**Preconditions:** At least one deck with cards.

**Main flow:**
1. Learner opens the app; Today shows due reviews, new cards, estimated time and streak.
2. Learner optionally selects a mode (default Swipe) and taps **Start**.
3. System builds the session queue across all active decks (due reviews first, new cards interleaved, siblings
   buried, daily limits applied).
4. Learner answers cards (UC-11, UC-14, UC-15).
5. When the queue is empty, the summary is shown; streak updates.

**Alternatives:**
- 1a. Nothing due → Today offers "Learn extra new words" (temporarily raises today's new limit by 10) or
  "Practice difficult words" (UC-16).
- 2a. Learner taps a specific deck in "Decks due" → session limited to that deck.
- 4a. Learner leaves mid-session → answers are already saved; resuming within 30 min continues the queue.

## UC-09 Add a word with AI enrichment

**Actor:** Learner · **Screens:** S-08, S-09

**Preconditions:** Signed in, online, enrichment enabled on the server.

**Main flow:**
1. Learner types the word (e.g. "żółw") in the editor or quick add and taps "Fill with AI".
2. Client sends word, target and native languages to `/api/enrich`.
3. Server returns suggested translation, example, example translation, IPA and notes (e.g. "noun, masculine").
4. Suggestions appear as ghost values; Learner accepts all or per field, edits if needed, saves.

**Alternatives:**
- 3a. Quota exceeded → "Daily AI limit reached"; manual input continues.
- 3b. Provider error or timeout (10 s) → inline error, manual input continues.
- 4a. Fields already filled → accepting shows a confirm before overwriting.

## UC-10 Import a dictionary from CSV/TSV

**Actor:** Learner · **Screens:** S-10

**Preconditions:** A UTF-8 CSV/TSV file with columns among `front, back, example, example_translation, ipa, tags,
notes` (names can differ; mapping is manual or automatic).

**Main flow:**
1. Learner opens Import (from Decks, a deck, or onboarding) and picks a file or pastes text.
2. Learner selects the target deck or creates a new one (with languages).
3. System detects delimiter and header, shows a preview of 10 rows and auto-maps columns.
4. Learner adjusts mapping if needed and continues.
5. System validates all rows: ready, duplicates (by normalized front within the deck), errors (missing front or
   back, too long).
6. Learner chooses the duplicate strategy (Skip / Update existing / Import anyway) and confirms.
7. System inserts cards in batches of 500 inside transactions, creating new states for active directions.
8. Result screen shows counts; Learner starts studying or opens the deck.

**Alternatives:**
- 3a. File not UTF-8 → error with advice to re-save as UTF-8.
- 5a. All rows invalid → import blocked; error report downloadable.
- 7a. Very large file → parsing and insertion run in a Web Worker with progress.

**Postconditions:** Cards exist as New; queued for sync.

## UC-11 Swipe study session

**Actor:** Learner · **Screens:** S-11

**Main flow:**
1. The card shows the prompt (studied word for forward, translation for reverse); audio autoplays for forward if
   enabled.
2. Learner taps to flip and sees the answer, example and notes (audio plays on reveal for reverse).
3. Learner swipes right (Know → Good) or left (Don't know → Again); in detailed mode also Hard (button) or Easy
   (swipe up).
4. System computes the next FSRS state, stores it and the review log atomically, and shows the next card.
5. Cards answered Again return later in the same session according to learning steps.

**Alternatives:**
- 2a. Learner swipes without flipping → treated as an answer.
- 3a. Learner uses buttons instead of swipes (accessibility).

**Postconditions:** States and logs updated; changes queued for sync.

## UC-12 Listen to pronunciation

**Actor:** Learner · **Screens:** S-07, S-08, S-11, deck list

**Main flow:**
1. Learner taps a speaker icon or the word.
2. If the card has server audio: play from cache, or download and cache when online.
3. Otherwise: speak via Web Speech API with the deck's language and the device's preferred voice.

**Alternatives:**
- 2a. Audio not cached and offline → fall back to the system voice.
- 3a. No voice for the language → hint with the voice guide (UC-22).
- Learner taps the example sentence → the sentence is spoken.

## UC-13 Fix pronunciation with generated audio or a recording

**Actor:** Learner · **Screens:** S-07

**Preconditions:** Signed in, online; TTS and/or Commons enabled.

**Main flow:**
1. Learner hears a wrong pronunciation (e.g. a homograph) and opens the card.
2. Optionally enters or corrects the IPA transcription.
3. Learner taps **Generate audio**; server synthesizes speech with the IPA phoneme hint and attaches it.
4. Learner plays the new audio; it becomes the default for this card on all devices after sync.

**Alternatives:**
- 3a. Learner taps **Find recording** → server searches Wikimedia Commons; if found, attaches it with
  attribution; else `not_found`.
- 4a. Learner is not satisfied → Remove audio (back to system voice) or regenerate with another voice.

## UC-14 Multiple-choice and listening modes

**Actor:** Learner · **Screens:** S-11

**Main flow (multiple choice):**
1. Learner selects mode "Choice" on Today and starts.
2. Prompt shown with four options; Learner taps one.
3. Correct → Good; wrong → Again with correct answer highlighted and "Continue".

**Main flow (listening):**
1. Learner selects "Listening"; the word is spoken automatically (replay and slower replay available).
2. Learner chooses the written word among four options (or types it, depending on settings).
3. Rating as above; the review log records mode `listen`.

**Alternatives:** Fewer than 4 cards in the deck → options are filled from other decks with the same language, or
the mode is unavailable with a hint.

## UC-15 Typing mode

**Actor:** Learner · **Screens:** S-11

**Main flow:**
1. Prompt shows the translation; Learner types the studied word and presses Enter.
2. System normalizes and compares: exact → Good; near miss (small typo or missing diacritics) → Hard with diff;
   otherwise → Again with the correct answer shown and spoken.
3. Learner taps Continue (auto-advance on Good).

**Alternatives:** "I don't know" → Again.

## UC-16 Practice difficult words

**Actor:** Learner · **Screens:** S-04, S-06, S-12

**Main flow:**
1. Learner taps "Practice difficult" (deck, Today when nothing is due, or session summary "Repeat these now").
2. System builds a practice queue: cards with lapses ≥ 3 or low stability, or those failed in the last session.
3. Learner studies in any mode.

**Postconditions:** Practice answers are logged with `mode` and `practice = true` (`review_log.practice`) but **do not change FSRS states** for
cards not yet due (avoids distorting intervals); cards that are due are scheduled normally.

## UC-17 Undo the last answer

**Actor:** Learner · **Screens:** S-11

**Main flow:**
1. Learner realizes the last swipe was wrong and taps ↶.
2. System restores the previous state from the log snapshot, soft-deletes the log entry, and shows the card again.

**Constraints:** Only the most recent answer in the current session; one level of undo.

## UC-18 Study offline

**Actor:** Learner

**Preconditions:** App installed and opened at least once online (app shell cached).

**Main flow:**
1. Learner opens the app without connectivity (metro, plane).
2. All local features work: study, add/edit cards, import, statistics, system voice pronunciation.
3. Changes accumulate in the outbox; the sync indicator shows pending changes.
4. When connectivity returns, the sync engine pushes and pulls automatically (UC-20).

**Alternatives:** Server-only features show "Available online". Uncached server audio falls back to the system
voice.

## UC-19 View statistics

**Actor:** Learner · **Screens:** S-13

**Main flow:** Learner opens Statistics, selects period and deck, reviews charts (reviews per day, forecast, states,
retention, time) and KPIs (streak, mature cards).

## UC-20 Sync between devices

**Actor:** Learner, System · **Screens:** S-15, sync indicator

**Preconditions:** Signed in on two devices (e.g. iPhone and laptop).

**Main flow:**
1. Learner adds 20 words on the laptop.
2. The laptop's sync engine pushes changes within seconds.
3. Learner opens the app on the iPhone; on start/foreground, the sync engine pulls and the new words appear.
4. Learner studies on the iPhone; states and logs are pushed; the laptop receives them on next sync.

**Alternatives:**
- Same card edited on both devices offline → the later edit wins (LWW); no dialog.
- Push rejected rows (ownership, validation) → shown in the sync log with details.
- Device clock differs from server by > 5 min → warning in Settings.

## UC-21 Configure study settings

**Actor:** Learner · **Screens:** S-14

**Main flow:** Learner changes new words per day, max reviews, answer mode, IPA on front, day start hour, desired
retention or autoplay; changes apply to the next session and sync to other devices.

## UC-22 Choose a voice

**Actor:** Learner · **Screens:** S-16

**Main flow:**
1. Learner opens Settings → Audio → Voices and selects a language (e.g. Polish).
2. System lists voices available on this device with quality badges.
3. Learner plays samples and selects one; it is saved for this device only.

**Alternatives:** Only default-quality voices → guide explains how to download Enhanced/Premium voices in iOS
Settings; after returning, the list refreshes.

## UC-23 Receive study reminders

**Actor:** Learner, System · **Screens:** S-14

**Preconditions:** App installed to the Home Screen (iOS 16.4+), signed in, server has VAPID keys.

**Main flow:**
1. Learner enables reminders and picks a time (e.g. 20:00).
2. Browser asks for notification permission; subscription is sent to the server.
3. Every day at that time, if the Learner has due cards and has not studied today, the server sends a push
   "18 words to review".
4. Tapping the notification opens Today.

**Alternatives:** Permission denied → setting reverts with an explanation.

## UC-24 Export a backup

**Actor:** Learner · **Screens:** S-14, S-05

**Main flow:**
1. Learner selects Export: full JSON backup (all decks, cards, states, logs, settings) or CSV of a single deck
   (import format columns).
2. The file is generated locally and shared via the iOS share sheet / downloaded.

## UC-25 Restore a backup

**Actor:** Learner · **Screens:** S-14

**Main flow:**
1. Learner selects "Import backup" and picks a JSON export.
2. System validates the format version and shows counts.
3. Learner chooses: **Replace local data** or **Add as new decks** (IDs regenerated to avoid collisions).
4. Data is written locally and synced.

**Alternatives:** Incompatible version → error with the required app version.

**Note:** local restore (reading the file on the device) is available from Phase 1 (decision D9); the server
endpoint `POST /api/import/json` arrives in Phase 2. Format: architecture.md §6.5.

## UC-26 Install the app on iPhone

**Actor:** Learner

**Main flow:**
1. Learner opens the app URL in Safari.
2. The install hint explains: Share → Add to Home Screen → Add.
3. Learner launches from the Home Screen icon; the app runs standalone (full screen, own icon, offline cache).

## UC-27 Switch the UI language

**Actor:** Learner · **Screens:** S-01, S-14

**Main flow:** Learner selects Русский or English; the interface re-renders immediately; the choice is stored in
settings and synced.

## UC-28 Invite a user

**Actor:** Admin · **Screens:** S-15 (Invites)

**Main flow:**
1. Admin opens Account & sync → Invites and taps "Create invite".
2. Admin enters a note ("Anna") and expiry (default 7 days).
3. Server creates a single-use code; the app shows the invite link with Copy and Share.
4. Admin sends the link; the invitee registers (UC-02); the invite shows as used.

**Alternatives:** Admin revokes an unused invite. Invites can also be created via CLI:
`annette-cards invite --note Anna --days 7`.

## UC-29 Operate the server

**Actor:** Admin

**Flows:**
- **Bootstrap:** on the VPS, run `annette-cards create-user --email … --admin` to create the first account.
- **Deploy:** `just deploy` uploads the new binary, switches the release symlink and restarts the service;
  migrations run on start. Rollback: switch the symlink back and restart.
- **Backup:** Litestream replicates continuously; Admin periodically verifies with `litestream restore` to a temp
  file.
- **Restore:** stop the service, `litestream restore` the database, start the service.
- **Monitor:** `/api/health` checked by an uptime monitor; logs via `journalctl -u annette-cards`.

## UC-30 Optimize FSRS parameters

**Actor:** Learner · **Screens:** S-14

**Preconditions:** At least ~1 000 review log entries; signed in, online.

**Main flow:**
1. Learner taps "Optimize" in study settings.
2. Server runs the FSRS optimizer on the Learner's review log and returns weights with a comparison of predicted
   log loss (default vs optimized).
3. Learner applies the weights; they are stored in settings and used for future scheduling on all devices.

**Alternatives:** Not enough reviews → message with the current count and the required minimum.
