# Meta-prompt: generate implementation task prompts

You are a senior engineer and technical planner. Your job is to turn the Annette Cards documentation into a
**step-by-step, executable implementation plan for vibe coding**: a tree of Markdown prompt files under
`dev/impl/`, each of which can be pasted into (or referenced from) a fresh Claude Code session and executed
without further context.

You do **not** implement any application code in this task. You only produce prompt files and the minimal doc
edits described below.

---

## 1. Inputs — read all of them fully before writing anything

| File | Why |
| --- | --- |
| `CLAUDE.md` | Workflow, invariants, conventions, definition of done, `just` recipes |
| `README.md` | Public description, getting started, import format |
| `docs/plan.md` | Phases 0–4, subsections, checkboxes, acceptance criteria — **source of truth** |
| `docs/architecture.md` | Components, data model, sync protocol, API, background tasks, deployment, security, observability, open questions |
| `docs/tech_stack.md` | Libraries and tools per layer |
| `docs/ui_ux.md` | Screens S-01…S-16, navigation, gestures, states, accessibility, localization |
| `docs/use_cases.md` | UC-01…UC-30 with flows and alternatives |

If documents contradict each other in a way that changes what gets built, **stop and list the conflicts as
questions** before generating files. Minor wording differences are not conflicts.

---

## 2. Decisions already made (do not re-ask)

- **Granularity:** one task file per **plan subsection** (e.g. Phase 1 → `1.4 Study engine` is one task). Phase 0
  has no numbered subsections; use its `###` headings (`Repository and tooling`, `Web skeleton`, `Server
  skeleton`) as tasks. If a subsection is clearly too big for one focused session (rule of thumb: more than ~8
  checkboxes spanning both server and client, or more than ~1 day of work), split it into `a`/`b` tasks and say
  why in the phase overview. Never merge subsections.
- **Numbering:** phase directories match `plan.md` phase numbers: `phase-00-bootstrap`, `phase-01-local-mvp`,
  `phase-02-backend-sync`, `phase-03-audio-ai`, `phase-04-polish`, then any additional phases continue at
  `phase-05-…`.
- **`docs/plan.md` stays the source of truth.** Task files reference the checkboxes they cover; executing a
  task ticks those checkboxes in `plan.md`. `plan.md` gets a link to each task file (see §6).
- **Git:** each task ends with one Conventional Commit on `main` (`feat(web): …`, `feat(server): …`,
  `chore: …`, `docs: …`). No branches or PRs.
- **Language:** all generated files in English.

---

## 3. Gap analysis — cover the full architecture

Before writing tasks, build a coverage matrix (keep it in `dev/impl/00-overview.md`, §7.1):

1. List every item that must exist in the finished system, taken from:
   - every section of `architecture.md` (§3 containers, §4.1–4.7 client, §5.1 modules, §5.3 every API
     endpoint, §5.4 every table, §5.5 settings, §6 sync, §7 audio, §8 enrichment, §9 security, §10
     configuration, §11 every background task, §12 deployment, §13 observability, §15 open questions);
   - every screen S-01…S-16 in `ui_ux.md` (including global components, gestures, edge cases, a11y, l10n);
   - every use case UC-01…UC-30;
   - every `just` recipe listed in `CLAUDE.md` and `plan.md`, plus commands mentioned in `README.md`
     (e.g. `just db-migrate`, `just dev-https`, `server/.env.example`);
   - every library in `tech_stack.md`.
2. Map each item to the task that implements it.
3. For every **unmapped** item:
   - if it naturally belongs to an existing subsection, add it to that task's scope **and** add a new checkbox to
     that subsection in `plan.md`;
   - otherwise create a new subsection in the right phase, or a **new phase** (e.g. `phase-05-hardening` for
     cross-cutting items that fit nowhere) and add it to `plan.md` with goal, checkboxes and acceptance.
4. Items explicitly in the **Backlog** section of `plan.md` stay out of scope — list them in the matrix as
   "backlog, not planned" and do not create tasks.
5. Open questions (`architecture.md` §15) become explicit decision steps inside the task where the answer is
   first needed (e.g. OGG playback in 3.1), with the instruction to record the decision in `architecture.md`.

Mark anything you added (not present in `plan.md` before) with `(added)` in the overview so the owner can
review it.

---

## 4. Output structure

```
dev/
  impl/
    00-overview.md
    phase-00-bootstrap/
      00-phase-overview.md
      task-01-<slug>.md
      task-02-<slug>.md
      ...
    phase-01-local-mvp/
      00-phase-overview.md
      task-01-data-layer.md
      ...
    ...
```

Slugs: lowercase kebab-case, 2–4 words, derived from the subsection title. Task numbers are two-digit and
reflect **execution order** within the phase.

Each phase ends with a final task `task-NN-phase-acceptance.md` that verifies the phase's **Acceptance**
criteria from `plan.md` (runs `just lint`, `just test`, `just e2e`, lists manual iPhone checks, fixes gaps,
updates README status). This task does not add features.

---

## 5. File templates

### 5.1 `dev/impl/00-overview.md`

```markdown
# Implementation plan — overview

## How to use
- Execute tasks strictly in order: phase by phase, task by task.
- Start each task in a fresh Claude Code session: "Execute `dev/impl/phase-XX-…/task-YY-….md`".
- A task is done only when its Definition of done is met and it is committed.
- `docs/plan.md` remains the source of truth for status (checkboxes).

## Phases
| # | Directory | Goal | Tasks | Use cases | Depends on |

## Task index
| ID | Task | Plan section | Main area (web/server/deploy/docs) |
(ID format: P1-T04)

## 7.1 Coverage matrix
| Source item | Task ID | Note |
(every architecture section, API endpoint, table, screen, use case, background task, just recipe;
 `(added)` for new items; "backlog, not planned" for backlog items)

## Added items for owner review
(bullet list of everything added beyond the original plan.md)
```

### 5.2 `phase-XX-<slug>/00-phase-overview.md`

```markdown
# Phase X — <name>

**Goal:** (from plan.md)
**Use cases:** UC-…
**Screens:** S-…
**Prerequisites:** (previous phases / external accounts: VPS, S3 bucket, Azure TTS key, Anthropic key, …)

## Tasks
| # | File | Scope (plan.md section) | Depends on | Est. size (S/M/L) |

## Execution notes
(ordering rationale, splits, things that are easy to get wrong in this phase)

## Phase acceptance
(verbatim from plan.md, plus any added criteria)
```

### 5.3 `task-NN-<slug>.md` — the actual prompt

Write each task as a **prompt addressed to Claude Code**, self-contained, imperative, concrete. Structure:

```markdown
# PX-TNN — <title>

## Context
One paragraph: where the project is at this point (what previous tasks produced) and why this task matters.

## Read first
Exact references, not whole documents:
- `CLAUDE.md` (always)
- `docs/architecture.md` §4.2, §4.3 …
- `docs/ui_ux.md` S-05, S-06 …
- `docs/use_cases.md` UC-05 …
- `docs/tech_stack.md` → <libraries used here>

## Scope
Checkboxes covered, copied verbatim from `docs/plan.md` (section X.Y), plus any `(added)` items.

## Out of scope
What a tempted implementer might also do but must not (belongs to later tasks — name them).

## Implementation steps
Numbered, each with a verification:
1. <step> → verify: <command or observable result>
2. …
Name concrete files/modules according to the repository layout in CLAUDE.md
(e.g. `web/src/domain/scheduler/…`, `server/src/auth/…`, `server/migrations/…`).
Include key types, table/column names, endpoint paths, i18n key namespaces, and edge cases from the docs.
Do not paste large code; give signatures and data shapes where they remove ambiguity.

## Tests
Specific test cases to write (unit / `#[sqlx::test]` / router `oneshot` / Vitest / fake-indexeddb /
Playwright WebKit), including the edge cases from use-case alternative flows.

## Invariants to respect
Only the CLAUDE.md invariants relevant to this task (offline-first, outbox, soft delete, user_id filter, …).

## Rust learning notes (server tasks only)
New Rust concepts this task introduces for the first time in the codebase; instruct the executor to explain
them briefly in the final task summary (per CLAUDE.md).

## Docs to update
List each document that must change if behavior/schema/API/stack/commands change:
`docs/architecture.md`, `docs/tech_stack.md`, `docs/ui_ux.md`, `docs/use_cases.md`, `CLAUDE.md`,
`README.md`, `docs/plan.md`. Be specific (e.g. "add `db-migrate` to the Commands table in CLAUDE.md").
Always: tick the covered checkboxes in `docs/plan.md`.

## Definition of done
- [ ] All scope items implemented
- [ ] Tests written and passing: `just test` (and `just e2e` for client flows, WebKit mandatory)
- [ ] `just lint` clean
- [ ] Works offline in WebKit (client features)
- [ ] Docs updated as listed above; plan.md checkboxes ticked
- [ ] Committed: `<type>(<scope>): <message>`

## If unclear
If anything in this task is ambiguous or conflicts with the docs, stop and ask before implementing.
```

---

## 6. Doc edits made by this meta-prompt

Only these, in the same change:

1. `docs/plan.md`:
   - under each subsection heading (and Phase 0 `###` headings) add one line:
     `Task: [PX-TNN](../dev/impl/phase-XX-…/task-NN-….md)`;
   - add new checkboxes / subsections / phases produced by the gap analysis, marked so they are
     recognizable in the diff; update the Overview table if phases were added;
   - add a phase-acceptance line linking the `task-NN-phase-acceptance.md` of each phase.
2. `CLAUDE.md`: in the Workflow section, add one line saying that step-by-step task prompts live in
   `dev/impl/` (start from `dev/impl/00-overview.md`) and that `docs/plan.md` stays the status source of truth.
   Add `dev/` to the repository layout tree.
3. `README.md`: add `dev/impl/00-overview.md` to the Documentation list.

Do not change architecture, stack, UI/UX or use cases here — any change they need is written as a
"Docs to update" step inside the relevant task.

---

## 7. Quality rules for the generated prompts

- **Self-contained:** an executor with only the repo and the task file can do the work. No "as discussed".
- **Traceable:** every task references plan section, use cases, screens and architecture sections.
- **Ordered:** a task never depends on something produced later. Server API needed by the client is created
  (and `just gen-api` run) in an earlier or the same task.
- **Vertical and verifiable:** each task ends in a runnable, testable state; every step has a verify line.
- **Consistent with CLAUDE.md:** use `just` recipes (never ad-hoc command sequences when a recipe exists),
  respect invariants, Rust-for-learners style, no hardcoded UI strings (keys in `en.json` and `ru.json`).
- **Doc freshness:** any task that changes behavior, schema, API, stack, commands, UI or flows lists the exact
  docs to update — including `CLAUDE.md` and `README.md` when commands, layout or setup change.
- **No scope creep:** nothing outside `plan.md` except items produced by the gap analysis (marked `(added)`).
- **Size:** task files are typically 60–200 lines. Longer means split; shorter usually means missing detail.
- **Precise names:** use table, column, endpoint, screen, component and setting names exactly as in the docs.

---

## 8. Procedure

1. Read all inputs (§1). Report contradictions as questions and wait if any are blocking.
2. Build the coverage matrix and gap list (§3).
3. Write `dev/impl/00-overview.md`.
4. For each phase: write `00-phase-overview.md`, then its task files in order, then the phase-acceptance task.
5. Apply doc edits (§6).
6. Self-check:
   - every `plan.md` checkbox appears in exactly one task's Scope;
   - every coverage-matrix row maps to a task or is marked backlog;
   - every link in `plan.md` and `00-overview.md` resolves to an existing file
     (e.g. `grep -o 'dev/impl/[^)]*' docs/plan.md | xargs -I{} test -f {}`);
   - task order within each phase respects the "Depends on" column.
7. Commit: `docs: add step-by-step implementation task prompts`.
8. Reply with a short summary: number of phases and tasks, list of `(added)` items, and any open questions for
   the owner.
