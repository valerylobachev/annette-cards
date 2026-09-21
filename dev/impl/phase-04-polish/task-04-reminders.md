# P4-T04 — Reminders

## Context
The app is deployed, users sync `user_settings`, `card_states` and `review_log` to the server, and study-day and
streak logic exist on the client (P4-T03). The `reminder` object (`{ enabled, time, tz }`) is already part of the
settings document but unused. This task adds daily Web Push reminders: the server stores push subscriptions and,
every minute, notifies users whose reminder time has come, who have due cards and who have not studied today.
Web Push works on iOS only for Home-Screen-installed PWAs (iOS 16.4+).

## Read first
- `CLAUDE.md` (always; iOS gotchas: Web Push only for installed PWAs)
- `docs/architecture.md` §4.7 (service worker), §5.1 `push/`, §5.3 `/api/push/subscribe`, `/api/meta`, §5.4
  `push_subscriptions`, `card_states`, `review_log`, `user_settings`, §5.5 `reminder` and `day_start_hour`, §10
  `ANNETTE_VAPID_PUBLIC_KEY` / `_PRIVATE_KEY`, §11 Reminders
- `docs/ui_ux.md` S-14 Reminders section
- `docs/use_cases.md` UC-23
- `docs/tech_stack.md` → `web-push`, tokio interval tasks

## Scope
From `docs/plan.md` 4.3:
- [ ] VAPID config, `push_subscriptions`, subscribe/unsubscribe endpoints
- [ ] Reminder task (per-user time and timezone, only when due cards exist and not studied today)
- [ ] Client: permission flow (installed PWA only), notification click opens Today

## Out of scope
- Any other notification type (sync, streak-at-risk). Only the daily study reminder.
- Server-side scheduling logic beyond counting due cards (FSRS stays on the client).

## Implementation steps
1. Config: add optional `vapid_public_key` / `vapid_private_key` to `config.rs` (`ANNETTE_VAPID_*`), add them
   (empty) to `server/.env.example`; `/api/meta` reports `push: true` only when both are set and includes the
   public key as `vapid_public_key` (null otherwise). → verify: router test for `/api/meta` with and without keys.
2. Migration (`just db-new push_subscriptions`): table exactly as §5.4 plus index on `user_id`. Run
   `just sqlx-prepare` after writing queries. → verify: `#[sqlx::test]` applies migrations.
3. `server/src/push/`: DTO `PushSubscriptionDto { endpoint, keys: { p256dh, auth } }`;
   `POST /api/push/subscribe` upserts by `endpoint` (an endpoint re-registered by another user is moved to the
   current user); `DELETE /api/push/subscribe { endpoint }` deletes only the current user's row. Both require
   `CurrentUser`; return `push_disabled` when keys are missing. Add utoipa annotations, then `just gen-api`.
   → verify: router tests with `oneshot`.
4. Sender: `PushSender` wrapping the `web-push` crate — builds a VAPID signature from the private key, sends a
   JSON payload **with data only** (no user-visible text, per CLAUDE.md):
   `{ "type": "reminder", "due": 18 }`. On `410 Gone`/`404` delete the subscription. Put the sender behind a
   small trait so tests use a fake. → verify: unit test with the fake sender.
5. Reminder selection (`push/reminders.rs`), pure where possible:
   `fn is_reminder_due(settings: &ReminderSettings, now_utc: i64) -> bool` — converts `now` to the user's `tz`
   (`chrono-tz`), compares `HH:MM` with `reminder.time`;
   `fn study_day_start(now_utc, tz, day_start_hour) -> i64`.
   Service query per candidate user (always filtered by `user_id`): due count = non-deleted `card_states` with
   `due <= now` whose card and deck are not deleted and deck not archived; studied today = exists non-deleted
   `review_log` with `reviewed_at >= study_day_start`. Send only if `due > 0` and not studied today.
   → verify: unit + `#[sqlx::test]` tests below.
6. Background task: in `serve`, spawn a `tokio::time::interval(60 s)` loop with
   `MissedTickBehavior::Skip`, next to the hourly session cleanup; errors are logged, never crash the server;
   the loop is skipped when push is disabled. → verify: manual run with `RUST_LOG=debug` shows one tick per minute.
7. Client service worker: add `push` and `notificationclick` handlers. If the current `vite-plugin-pwa` strategy
   is `generateSW`, switch to `injectManifest` (custom `web/src/sw.ts` keeping precache + existing runtime
   caching) and record the decision. The SW builds the localized text from bundled `en`/`ru` strings using
   `ui_language` stored in IndexedDB `settings` ("18 words to review" / "18 слов на повторение", i18next-style
   plural rules via `Intl.PluralRules`). Click → focus an open client or `clients.openWindow('/')` (Today).
   → verify: Playwright Chromium test dispatches a synthetic push event (WebKit cannot); manual iPhone check.
8. Settings UI (S-14 Reminders): toggle + time picker. Enable flow: if not standalone
   (`matchMedia('(display-mode: standalone)')` / `navigator.standalone`) → explanation "Install the app to get
   reminders", toggle stays off; else `Notification.requestPermission()` inside the tap handler →
   `pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })` → `POST /api/push/subscribe` →
   save `reminder = { enabled: true, time, tz: Intl.DateTimeFormat().resolvedOptions().timeZone }` via the
   settings repository. Denied → revert toggle with explanation (UC-23 alternative). Disable → unsubscribe +
   `DELETE`. Sign-out also unsubscribes. Offline → "Available online" hint. i18n keys `settings.reminders.*`.
   → verify: component tests with mocked `Notification`/`PushManager`.

## Tests
- `is_reminder_due`: `time = "20:00"`, `tz = "Europe/Riga"`, now = 17:00 UTC in summer (UTC+3) → true; 18:00 UTC →
  false; DST transition day still fires once.
- Due + studied today: due cards and no logs since study-day start → send; a log at 04:30 local with
  `day_start_hour = 4` → no send; a log at 03:30 local (previous study day) → send; undone (soft-deleted) log
  does not count; no due cards → no send; archived deck's cards don't count; reminder disabled → no send.
- Isolation: user A's logs never affect user B.
- Subscribe twice with the same endpoint → one row; DELETE of another user's endpoint → 404/no-op.
- 410 from the push service removes the subscription.
- Client: permission denied reverts setting; not-standalone shows the install explanation; payload formatting in
  RU plural forms (1 слово / 2 слова / 5 слов).

## Invariants to respect
- Every server query touching user data filters by `user_id`.
- No user-visible strings from the server; the SW localizes.
- Secrets (VAPID private key) only on the server; only the public key is exposed via `/api/meta`.
- UI never calls the API for user data; settings writes go through the repository + outbox.

## Rust learning notes (server tasks only)
Explain briefly in the task summary: the `web-push` crate (VAPID signature builder, message builder, async
client), time-zone handling with `chrono-tz` (UTC ms → zoned local time, DST), a long-running `tokio::spawn` loop
with `interval` and `MissedTickBehavior`, and using a trait object (`Arc<dyn PushSender>`) in `AppState` so
tests can swap in a fake.

## Docs to update
- `docs/tech_stack.md`: `chrono-tz` (server) and the SW strategy change if made.
- `docs/architecture.md` §4.7 (push handlers, `injectManifest` decision), §5.3 (request/response of
  `/api/push/subscribe`, `vapid_public_key` in `/api/meta`), §11 (exact selection rules), §10 (VAPID variables).
- `docs/ui_ux.md` S-14 Reminders states; `deploy/README.md`: how to generate VAPID keys.
- `docs/plan.md`: tick the three 4.3 checkboxes.

## Definition of done
- [ ] All scope items implemented
- [ ] Tests written and passing: `just test` and `just e2e` (WebKit; Chromium for the push event)
- [ ] `just lint` clean
- [ ] Works offline in WebKit (reminder settings show "Available online")
- [ ] Docs updated as listed above; plan.md checkboxes ticked
- [ ] Committed: `feat: add daily web push study reminders`

## If unclear
If anything in this task is ambiguous or conflicts with the docs, stop and ask before implementing.
