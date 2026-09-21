# P2-T10 — Phase 2 acceptance

## Context

All Phase 2 tasks (P2-T01…T09) are done: auth with invites, server sync (push/pull/summary/export/restore),
client sync engine, first-sign-in and sign-out flows, and a production server on the VPS with Litestream backups
and an uptime check. This task verifies the phase acceptance criteria end to end, fixes gaps found, and updates the
project status. It adds **no features**.

## Read first

- `CLAUDE.md` (always)
- `docs/plan.md` Phase 2 (all checkboxes and **Acceptance**)
- `dev/impl/phase-02-backend-sync/00-phase-overview.md`
- `deploy/README.md`
- `docs/use_cases.md` UC-02, UC-03, UC-04, UC-20, UC-25, UC-28, UC-29

## Scope

Phase 2 **Acceptance** from `docs/plan.md`:

> Owner and one invited user each use the app on two devices; offline edits on both converge after reconnect; a
> VPS restart and a restore drill lose no data.

Added criteria (from the phase overview):

- `just lint`, `just test`, `just e2e` (WebKit) are green; CI is green on `main`.
- `/api/health` is monitored by the uptime check.
- `deploy/README.md` documents deploy, rollback, backup verification and restore.

## Out of scope

- New features or refactors. Bugs found are fixed minimally with tests, each in its own `fix(...)` commit.
- Phase 3 work (audio, AI).

## Implementation steps

1. **Checkbox audit.** Every Phase 2 checkbox in `docs/plan.md` (including `(added)` ones) is ticked and the code
   exists. → verify: `grep -n '\- \[ \]' docs/plan.md` shows no unchecked Phase 2 items.
2. **Automated gates.** Run `just lint`, `just test`, `just e2e`. → verify: all green; WebKit project ran.
   Check the latest CI run on `main` (`gh run list --branch main --limit 3`).
3. **Docs consistency.** Compare `docs/architecture.md` §5.3 against `web/openapi.json` (every endpoint present, no
   undocumented ones); error codes in §5.3 all have `errors.<code>` keys in `en.json` and `ru.json`; `CLAUDE.md`
   Commands match the `justfile`; `README.md` Getting started works from a clean clone (`create-user`, `db-migrate`).
   → verify: list of mismatches is empty (fix docs where needed).
4. **Manual acceptance with the owner** (guide step by step, record results):
   1. Owner creates an invite in S-15 and sends the link to the invited user; invited user registers on iPhone.
   2. Owner uses iPhone + laptop; invited user uses two devices (phone + laptop/tablet). All four signed in.
   3. On each account: device 1 goes offline (airplane mode), adds 3 cards and studies 5; device 2 (also offline)
      edits one of the same cards and studies other cards. Reconnect both → within a minute both devices show
      identical decks, cards (LWW winner for the conflicting card) and due counts; outbox empty; indicator ✓.
   4. Users cannot see each other's data.
   5. Restart: `sudo systemctl restart annette-cards` and reboot the VPS; data intact on all devices.
   6. Restore drill per `deploy/README.md` into a temp file; `PRAGMA integrity_check` ok; counts match the live DB.
   7. Uptime monitor shows the service up.
   8. Sign-out with unsynced changes on one device shows the warning (then cancel).
5. **Fix gaps** found in steps 2–4 with tests; re-run gates.
6. **Status update.** `README.md` Status line: Phase 2 complete, current phase 3. Update the "Operations log" in
   `deploy/README.md` with the drill date and results.

## Tests

- No new feature tests. Any bug fix adds a regression test (Rust `#[sqlx::test]` / router `oneshot`, Vitest, or
  Playwright WebKit) reproducing the issue first.

## Invariants to respect

- All CLAUDE.md invariants — this is the moment to spot violations: UI components calling the API for user data,
  missing `user_id` filters, missing outbox entries, hard deletes, hardcoded strings.
  → quick checks: `grep -rn "from '@/api" web/src/features --include=*.tsx` (only auth/sync/admin/meta allowed);
  `grep -rn "DELETE FROM" server/src` (only sessions cleanup and invite revoke allowed).

## Docs to update

- `README.md` status.
- `deploy/README.md` operations log.
- Any doc mismatch found in step 3.
- `docs/plan.md`: mark Phase 2 acceptance as met (add a line `**Accepted:** YYYY-MM-DD` under the Acceptance
  paragraph).

## Definition of done

- [ ] All acceptance criteria verified and recorded
- [ ] `just lint`, `just test`, `just e2e` green (WebKit mandatory); CI green
- [ ] Docs consistent with code; status updated
- [ ] Committed: `docs: accept phase 2 (backend and sync)` (plus separate `fix(...)` commits for any fixes)

## If unclear

If anything in this task is ambiguous or conflicts with the docs, stop and ask before implementing.
