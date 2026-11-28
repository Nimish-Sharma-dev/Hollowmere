# M3 coverage: every plan requirement, where it lives, how it is proven

Status key: **Proven** = verified by tests or scripts that run offline (you can re-run them). **Written, needs your accounts** = code exists but can only be proven with your key or Supabase project (see `docs/VERIFY_M3.md`).

## Task checks (BUILD_PLAN section 14)

| Task | Plan check | Status | Proof |
|---|---|---|---|
| T017 | all prompts run against fixtures | Proven | `prompts-client.test.ts` "all prompts run end to end against fixtures", `plan-section9.test.ts` fixture set |
| T018 | cap and kill-switch tests pass | Proven (logic). Edge Function and SQL written, needs your accounts | `proxy.test.ts` (caps, budget, kill switch, cache, validation, logging); `npm run edge:smoke` for the live check |
| T019 | 1,000 headless runs, no LLM; divergence judge (mock) passes the gate | Proven | `runtime.test.ts` T019 test, `npm run director:sim` (1,000 runs, gate PASS) |
| T020 | a full run with mocked Director output | Proven | `runtime.test.ts` T020 tests (valid, hostile, broken, dead model, pre-generation) |
| T021 | a corpus of attack strings never changes game state | Proven | `sanitize-dialogue.test.ts` (30 strings x 3 model behaviours, state hash unchanged) |
| T022 | cost per simulated run is printed | Proven | `npm run cost`, `scripts-bundle.test.ts` |

## Section 9, LLM layer specifications (every bullet)

| Requirement | Implementation | Status / proof |
|---|---|---|
| One adapter interface `complete(promptId, vars, opts) -> validated JSON`, one implementation per provider | `LlmClient.complete(promptId, vars, opts)`, `MockProvider`, `AnthropicProvider` (`client.ts`) | Proven offline with a fake fetch (request shape, usage mapping, errors). The live Anthropic call: needs your key (`npm run llm:smoke`) |
| Timeouts | per-client and per-call `timeoutMs` | Proven (`prompts-client.test.ts`, `plan-section9.test.ts`) |
| One retry (stricter note) | invalid JSON or schema or provider error retried once; timeouts not retried | Proven |
| Token counting | usage from the provider, estimate in the mock, per-prompt output caps, per-call lower cap | Proven |
| Prompt registry P0 to P9, versioned, each with a schema and a fixture set | `prompts.ts` (P1 to P9 + `constitution()` for P0), `schemas.ts`, `fixtures.ts`, text generated from `docs/PROMPTS.md` and checked in sync | Proven. (Schemas are a tiny strict validator, not Zod: T003 is outside M3) |
| Prompt caching: stable parts first | the constitution is sent as the cache-marked system prefix | Proven for the constitution. **Limit:** the Run Bible and library digest sit inside the prompt body in the order PROMPTS.md defines, so only the constitution is marked for caching. Reordering those templates is a prompt-design change, not done |
| Pre-generation: tomorrow's morning beat at evening | `runtime.ts` (eligibility judged as of tomorrow morning, re-validated next morning) | Proven (`runtime.test.ts`) |
| Pre-generation: first reply of a likely dialogue | `prefetchDialogue` + `requestDialogue(..., prefetched)` | Proven (`plan-section9.test.ts`: used with no new call; discarded when intent, angle, NPC, typed text or clue gate differ) |
| Caps: per player per day, per run, global daily budget; fallback silently | `proxy.ts` (`perPlayerDayCalls`, `perRunCalls`, `dailyBudgetUsd`) | Proven (`proxy.test.ts`) |
| Kill switch (environment flag) | `KILL_SWITCH=1` env and a stored flag in the `budget` table | Proven in logic; the live switch needs your project |
| Call log with the listed columns | `CallRecord`, `llm_calls` table, `llm_spend_daily` view | Logic proven; SQL written, needs your project |
| Sanitizer: 120 to 200 char cap, strip control chars, wrap in `<player_text>`, profanity and link filter | `sanitize.ts` (120 chars) | Proven (corpus + property tests) |
| The validator is the real defense; the model only outputs known ids | `validateDirectorOutput`, `checkDialogue`, `validateRunBible` | Proven (jailbroken-model tests) |
| Fallback Director: weighted random over eligible events using tag match, anti-repeat, stance quota, the Run Bible's arc; exactly the P3 shape | `director.ts` | Proven (`bible-director.test.ts`, `plan-section9.test.ts`: arc acts followed, output always passes its own validator) |
| Fallback Run Bible builder: authored data + Seed Deck; never within distance 2 of a recent fingerprint | `bible.ts`, `lore.ts`, `seed.ts`, `fingerprint.ts`. The builder keeps distance >= 3 from each of the last 10 runs, and also satisfies the PROMPTS section 12 rules | Proven (600 and 1,000 run tests). **Note:** it composes from crisis tables rather than whole preset records |

## Also built (from PROMPTS.md and the data flow)

Stance quota 40/40/20 (enforced after 8 decisions, only when a compliant event exists and the player is not in crisis); lifeline when near collapse; foreshadowing after the arc midpoint; difficulty clamp -2..2; mock divergence judge (P8 shape) and gate; library gap collection (`library_gap` and `content_gaps`); secrets tied to crises; every NPC can be the villain; supabase migration with row level security; `npm run edge:smoke` end-to-end script.

## Not covered by M3 on purpose

Real-model quality (needs a key), the Phaser client (M2), Zod (T003), rumor engine and dilemma templates (M5, so `rumor_seed` and `dilemma_template_id` must be null), real dialogue fallback bank of 6 lines per NPC per angle (T015), the full 30-event library.
