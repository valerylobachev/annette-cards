# P3-T04 — Enrichment (server)

## Context

Phases 0–2 are done and P3-T01…T03 added server audio. Entering a word still means typing translation,
example, IPA and notes by hand. This task adds the server side of AI enrichment: `POST /api/enrich` takes a
word and the deck languages and returns suggested `back`, `example`, `example_translation`, `ipa` and `notes`
from an LLM (Anthropic API), validated as strict JSON with one retry, limited by a per-user daily quota tracked
in `enrich_usage`. Suggestions are never saved by the server; the client (P3-T05) shows them for confirmation.

## Read first

- `CLAUDE.md` (always)
- `docs/architecture.md` §5.1 (`enrich/`), §5.3 (`POST /api/enrich`, `/api/meta` features), §5.4
  (`enrich_usage`), §8 (enrichment), §9 (input limits), §10 (`ANTHROPIC_API_KEY`, `ANNETTE_LLM_MODEL`,
  `ANNETTE_ENRICH_DAILY_LIMIT`)
- `docs/use_cases.md` UC-09 (incl. alternatives 3a quota, 3b provider error/timeout 10 s)
- `docs/ui_ux.md` §7 (AI quota exceeded)
- `docs/tech_stack.md` → External services (Anthropic API), `reqwest`, `tower_governor`
- Code from P3-T01: `TtsProvider` trait pattern and `async-trait` usage

## Scope

From `docs/plan.md` §3.3:

- [ ] `Enricher` trait and Anthropic implementation; strict JSON prompt; validation and one retry
- [ ] Daily quota (`enrich_usage`), error codes
- [ ] Prompt tuned for EN→RU and PL→RU (Polish: gender, aspect pairs in notes)

## Out of scope

- Client UI ("Fill with AI", quick add suggestions) → P3-T05.
- Caching or storing suggestions on the server.
- Languages other than EN/PL targets must still work generically, but no special tuning.

## Implementation steps

1. **Config.** `anthropic_api_key: Option<String>` (`ANTHROPIC_API_KEY`), `llm_model: String`
   (`ANNETTE_LLM_MODEL`; pick a current fast, inexpensive Claude model as default and record it in §10),
   `enrich_daily_limit: u32` (`ANNETTE_ENRICH_DAILY_LIMIT`, default 200). Add to `server/.env.example`.
   `features.enrich` in `/api/meta` = key present. → verify: config unit test; `/api/meta` router test.
2. **Migration.** `just db-new enrich_usage` with the table from §5.4. → verify: `just sqlx-prepare` passes.
3. **DTOs** in `server/src/enrich/dto.rs` (`Serialize`, `Deserialize`, `ToSchema`):
   `EnrichRequest { front, target_lang, native_lang, context: Option<String> }`,
   `EnrichResponse { back, example, example_translation, ipa, notes }` (all `Option<String>` except `back`).
   Validate input: `front` non-empty after trim, ≤ 500 chars; languages non-empty BCP-47-ish; `context` ≤ 500.
   → verify: unit tests for validation → 400 `validation_failed`.
4. **Trait** `server/src/enrich/mod.rs`:
   ```rust
   #[async_trait] pub trait Enricher: Send + Sync {
       async fn complete(&self, prompt: &EnrichPrompt) -> Result<String, EnrichError>; // raw model text
   }
   ```
   `AppState` holds `Option<Arc<dyn Enricher>>`. Parsing, validation and retry live in the service, so they are
   tested with a fake that returns queued strings.
5. **Prompt** `server/src/enrich/prompt.rs`: `build_prompt(req) -> EnrichPrompt { system, user }`. System
   prompt: bilingual dictionary assistant; output **only** one JSON object with exactly the keys `back`,
   `example`, `example_translation`, `ipa`, `notes`; `back` in the native language with multiple meanings
   separated by `; `; `example` in the studied language, short and natural; `ipa` between slashes; `notes` short,
   in the native language. Language-specific guidance:
   - English → Russian: part of speech; phrasal verbs and irregular forms (e.g. `took/taken`) in notes;
     British vs American spelling/pronunciation per `target_lang` variant.
   - Polish → Russian: grammatical gender for nouns (`м. р.`/`ж. р.`/`ср. р.`), aspect pairs for verbs
     (`robić / zrobić`), keep diacritics exactly.
   → verify: snapshot-style unit tests of the built prompt for `en-GB` and `pl-PL`.
6. **Anthropic implementation** `AnthropicEnricher` with a shared `reqwest::Client` (timeout 10 s): `POST
   https://api.anthropic.com/v1/messages` with headers `x-api-key`, `anthropic-version`, `content-type`, body
   `{model, max_tokens, system, messages:[{role:"user", content}]}`; return the concatenated text blocks.
   Check the current Anthropic API documentation for the exact version header and response shape.
   Timeout → `EnrichError::Timeout`; other failures → `EnrichError::Provider`. Never log the key or full
   responses at `info`. → verify: optional manual smoke (step 9).
7. **Service** `server/src/enrich/service.rs`: `enrich(state, user, req)`:
   quota check (`count` for `user_id` + UTC `day` ≥ limit → 429 `enrich_quota_exceeded`); call `complete`;
   `parse_suggestion(text)` (trim code fences, `serde_json::from_str::<EnrichResponse>`, reject empty `back`,
   truncate fields to limits); on parse/validation failure retry **once** with the same prompt plus a short
   "return only valid JSON" reminder; second failure → 502 `provider_error`. On success increment
   `enrich_usage` with an upsert (`INSERT … ON CONFLICT(user_id, day) DO UPDATE SET count = count + 1`).
   Only successful responses count. → verify: tests below.
8. **Endpoint** `POST /api/enrich` (auth) → `EnrichResponse`; disabled → 409 `enrich_disabled`; timeout →
   504 `provider_timeout`; also a per-user burst limit (e.g. 20/min) → 429 `rate_limited`. Register in utoipa,
   then `just gen-api`. → verify: router tests; generated client contains the `enrich` call.
9. **Optional manual smoke (real key)** — check prompt quality on a small list: `to take off`, `read`
   (homograph), `żółw`, `robić`, `kot`, `through`. Record 2–3 example outputs in the task summary (not in the
   repo). Adjust the prompt until Polish notes contain gender/aspect.

## Tests

- `parse_suggestion`: valid JSON; JSON wrapped in ```json fences; extra unknown key (ignored or rejected —
  choose and test); missing `back` → error; non-JSON → error; oversized fields truncated.
- Service with `FakeEnricher`: valid first response → OK, usage = 1; invalid then valid → OK after one retry,
  exactly 2 calls; invalid twice → `provider_error`, usage unchanged; timeout → `provider_timeout`.
- `#[sqlx::test]` quota: with limit 2, third request → 429 `enrich_quota_exceeded`; another user unaffected;
  next UTC day resets (inject the clock/day).
- Router: unauthenticated → 401; disabled (no enricher) → 409 `enrich_disabled`; invalid input → 400.
- Prompt builder: `pl-PL` prompt contains gender/aspect guidance; `en-GB` mentions British variant.

## Invariants to respect

- Suggestions are never persisted as card data by the server.
- `enrich_usage` queries filter by `user_id`; timestamps/days computed in UTC.
- Error responses are stable codes; no user-visible strings.
- The API key stays on the server; never logged or returned.

## Rust learning notes (server tasks only)

Explain briefly in the final task summary:
- **serde validation**: deserializing into a struct as the first validation layer, then explicit checks;
  `Option<String>` for optional fields.
- **Retry as a plain loop** (`for attempt in 0..2`) instead of a retry crate.
- **SQLite upsert** with `ON CONFLICT … DO UPDATE` in `sqlx::query!`.
- **Injecting time** (a `Clock` or passing `now`) to make day-based logic testable.

## Docs to update

- `docs/architecture.md` §8: prompt structure, retry rule, which responses count toward the quota; §5.3 error
  codes (`enrich_disabled`, `enrich_quota_exceeded`, `provider_error`, `provider_timeout`, `validation_failed`,
  `rate_limited`); §10 default for `ANNETTE_LLM_MODEL`.
- `server/.env.example`: new variables.
- `docs/plan.md`: tick the three checkboxes above.

## Definition of done

- [ ] All scope items implemented
- [ ] Tests written and passing: `just test`
- [ ] `just lint` clean; `just sqlx-prepare` and `just gen-api` run, outputs committed
- [ ] Docs updated as listed above; plan.md checkboxes ticked
- [ ] Committed: `feat(server): AI card enrichment with daily quota`

## If unclear

If anything in this task is ambiguous or conflicts with the docs, stop and ask before implementing.
