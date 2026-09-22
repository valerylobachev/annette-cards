# Phase 4 acceptance log

Task: [P4-T08](task-08-phase-acceptance.md). Part A (verification) started 2026-09-22; Part B (closing) after 30
consecutive days in the usage log below.

## Part A — verification

### 1. Plan checkboxes

Phase 4 in `docs/plan.md`, checked 2026-09-22: every task is ticked except two that need the owner.

| Item | Status | What is left |
| --- | --- | --- |
| Accessibility pass (VoiceOver, dynamic type, contrast) | open | Automated part done in P4-T06 (axe gate in both themes, dynamic type up to 200 %, contrast fix). Left: the VoiceOver pass on the iPhone (see §4). |
| Measure DB size with audio, record the 1 GB decision | open | Decision recorded (keep audio BLOBs, ADR-6, architecture §15) from clip sizes. Left: the production numbers, `SELECT count(*), avg(length(bytes)), sum(length(bytes)) FROM audio_assets` on the VPS, and the file size of `/var/lib/annette-cards/annette.db`. |

### 2. Automated checks

Run on the MacBook, 2026-09-22, commit `1578979`:

| Check | Result |
| --- | --- |
| `just lint` | pass |
| `just test` | pass: 200 Rust tests, 400 web tests |
| `just e2e` (WebKit, Chromium, performance) | pass: 127 passed, 5 skipped |

Performance (P4-T06, WebKit, 10 000-card deck with 100 000 answers):

| Measurement | Target | Result |
| --- | --- | --- |
| Study session read + build | < 100 ms | 64–68 ms |
| Import of 10 000 rows | < 10 s | 2.6–3.1 s |
| Rendered rows at the end of the card list | < 100 | 19 |
| Search / alphabetical sort in the deck | < 200 ms | 35 ms / 25–28 ms |
| Statistics screen | < 500 ms (task target) | 640–700 ms — **not met**; the owner decides (architecture §15) |

### 3. Deploy

To do by the owner (`just deploy`), then record:

- [ ] `curl -s https://<domain>/api/health` → `{"status":"ok"}`
- [ ] `curl -s https://<domain>/api/meta` → `features.tts`, `commons`, `enrich`, `push` all `true` (push needs the
      VAPID keys in `/etc/annette-cards/env`, `deploy/README.md`)

### 4. Manual checks on the installed iPhone app

Mark each item `pass` or `fail` with a note.

| Check | Result | Note |
| --- | --- | --- |
| Swipe session on an EN deck and a PL deck, undo | | |
| Choice session on EN and PL, undo | | |
| Listening (choose) on EN and PL, undo | | |
| Listening (type) on EN and PL, undo | | |
| Typing on EN and PL; `żółw` typed as `zolw` → amber "Almost"; undo | | |
| Airplane mode: all four modes work; Statistics renders | | |
| Statistics numbers match a hand count for one day; streak equals Today's streak | | |
| Reminder set two minutes ahead arrives only with due cards and nothing studied today; tap opens Today; none after studying | | |
| FSRS Optimize on the owner's account (≥ 1 000 reviews) shows the comparison; Apply reaches the laptop after sync | | |
| `annette-cards-admin purge --dry-run` on the VPS prints counts | | |
| `journalctl -u annette-cards \| grep 'purge finished'` shows the daily run | | |
| VoiceOver: each study mode, deck and card swipe actions, sheets, snackbar | | |

## Part B — 30-day usage log

One line a day. Issues found here are fixed with a regression test (bugs) or moved to the Backlog in
`docs/plan.md` (features).

| Date | EN reviews | PL reviews | Modes used | Issues | Needed another app? (y/n) |
| --- | --- | --- | --- | --- | --- |
| | | | | | |
