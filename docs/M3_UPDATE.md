# M3 update: OpenAI provider, honest cost logging, coherent bibles

## What changed and why

1. **OpenAI provider** (`packages/director/src/client.ts`). `OpenAIProvider` calls Chat Completions (`/v1/chat/completions`) with `max_completion_tokens` and a JSON-object reply. Cached prompt tokens are split out of `prompt_tokens` so cost math stays right. `providerFromEnv` picks the provider from `LLM_PROVIDER` (default `anthropic`, so nothing changes for existing setups). The edge function and `llm:smoke` use it. Why: the team's credits are OpenAI credits and the plan says the model is "whatever your credits cover".
2. **Proxy prices** (`pricingFromEnv`, `cost.ts`). The deployed proxy had no way to set real prices, so `cost_usd` and therefore the daily budget cap used placeholder prices. Set `LLM_PRICE_IN_PER_M`, `LLM_PRICE_OUT_PER_M` (and optionally `LLM_PRICE_CACHED_PER_M`) as secrets. Without them the proxy still works and logs a warning.
3. **Misconfiguration is visible.** If the provider key or model is missing, the proxy still answers `fallback` / `kill_switch` for the player, but now writes `llm-proxy: model not configured: ...` to the function logs.
4. **Coherent fallback bibles (T019).**
   - Twists now declare the roles they need (`Twist.requires`). The builder only offers a twist the cast can carry and reserves an NPC for it; the validator rejects bibles whose twist has no one to land on (this also protects P2 output in M4).
   - The villain's main secret is the most specific one that fits the crisis, so the poisoned well gets the tainted-well secret instead of a generic one.
   - `Lore.roleCrises` stops bystanders taking a role that names a crisis the village does not have (`cult_leader`, `hoarder`).
   - `liar` is no longer a villain role in the poisoned well and the chapel (its only secret there was the generic false-name one).
   - New lint rules cover all of the above.
5. `.gitignore` now excludes `.env*`, `pricing.json` and `supabase/.temp`.

## Tests
200 tests (was 192). New: `packages/director/test/openai-coherence.test.ts`. The coherence test fails if either the specificity rule or the twist feasibility rule is removed (checked by deliberately breaking each).

## Known limits (not fixed here)
- The OpenAI adapter is verified against fake responses only. The live check is `docs/VERIFY_M3.md` Part 2B.
- Opening lines come from one fixed `arrival` sentence per NPC, whatever role they hold. Mayor Alder's line ("a welcome that comes a little too smoothly") hints at suspicion even when he is innocent. Fixing it needs role-specific arrival lines (a small contract change to `NpcCard` plus new writing) and your approval at checkpoint 3, so it is left for the content lane.
- The starter library still has 16 events and 12 secrets. About 2% of decisions find no eligible event (a content gap the harvesting loop in T035 is meant to fill).
- The P2 prompt's `LIBRARY_DIGEST` (M4) should include each twist's `requires`, or the model will keep proposing twists the validator rejects.
