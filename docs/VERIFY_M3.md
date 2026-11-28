# How to verify M3 (step by step)

Do **Part 1** first. It needs nothing but Node. Parts 2 and 3 are only for when you are ready to use a real model and Supabase.
If anything fails, send me the **exact command and the full error text**. Never paste an API key or the service role key into chat.

## Part 1: offline checks (no accounts, no keys)

Requirements: Node 22.18 or newer (`node -v`).

```
npm install
npm run verify
```
Expect: typecheck with no output, then `# tests 200`, `# pass 200`, `# fail 0` (takes about 25 seconds).

```
npm run director:sim
```
Expect `invalid bibles 0`, `invariant violations 0`, `distinct outcomes 1000`, `divergence gate PASS`.

```
npm run bibles -- 10
```
Prints 10 readable Run Bibles. **This is a human check:** do they feel like different games (different villain, crisis, tone, opening)? Does anything read badly? Tell me which lines to improve.
Since the coherence fix (see `docs/M3.md`), each villain's secret should belong to the crisis, each twist should name roles that are in the cast ("The friend was the informant" needs a friendly spy or traitor), and nobody should hold a role for a crisis that is not happening (no cult leader without a cult).

```
npm run cost -- --days 12 --budget 50
```
Prints the cost of one simulated run. It says `PLACEHOLDER` because the prices are not real yet (see Part 2, step 5).

Also run `npm run gen:prompts -- --check` and `npm run build:edge -- --check`: both should say "up to date".

## Part 2: switch on the real model (needs a key from ONE provider)

The adapter supports two providers. `LLM_PROVIDER` picks one (default `anthropic`). Use **2A** or **2B**, not both. Everything after the smoke test (prices, Supabase secrets) is the same except the key name.

### Part 2A: Anthropic

1. Go to console.anthropic.com, sign in, open **API keys**, create a key, copy it somewhere safe (a password manager). Do not commit it.
2. In the console **Billing / Limits**, set a **monthly spend limit** you are comfortable with before using the key.
3. Pick a model id from the console's model list (a small, cheap one is fine for testing). It is your decision (human checkpoint 6).
4. Run one tiny real call (about 100 output tokens).
   - macOS / Linux: `ANTHROPIC_API_KEY=your_key LLM_MODEL=model_id npm run llm:smoke`
   - Windows PowerShell: `$env:ANTHROPIC_API_KEY="your_key"; $env:LLM_MODEL="model_id"; npm run llm:smoke`
   Expect `SMOKE TEST PASSED` and a validated JSON object. If it fails, send me the printed `call:` lines and the failure line.
5. Put real prices in a file `pricing.json` (copy them from your provider's pricing page, USD per million tokens):
   `{ "default": {"inPerM": 0, "outPerM": 0, "cachedPerM": 0}, "models": { "model_id": {"inPerM": 0, "outPerM": 0, "cachedPerM": 0} } }`
   then `npm run cost -- --days 12 --budget 50 --model model_id --pricing pricing.json`. That is your real cost per run.

### Part 2B: OpenAI (use your OpenAI credits)

1. platform.openai.com > API keys: create a key and keep it in a password manager (never in chat, never in the repo). Under billing/limits, set a monthly limit you are comfortable with.
2. Pick a model id from your own **model list** (dashboard or `Models` page). Use the exact id. A small, cheap chat model is fine for testing. This is human checkpoint 6.
3. Run one tiny real call (about 100 output tokens). Windows PowerShell, with the key typed at a hidden prompt:
   ```
   $s = Read-Host "Paste OpenAI key" -AsSecureString
   $env:OPENAI_API_KEY = [System.Net.NetworkCredential]::new("", $s).Password
   $env:LLM_PROVIDER = "openai"
   $env:LLM_MODEL = "YOUR_MODEL_ID"
   npm run llm:smoke
   ```
   macOS / Linux: `LLM_PROVIDER=openai OPENAI_API_KEY=your_key LLM_MODEL=model_id npm run llm:smoke`
   Expect a first line `provider=openai model=...`, then `call: ok=true ...`, then `SMOKE TEST PASSED` and a validated JSON object.
4. If it fails, the failure line tells you what to do:
   - `openai http 401`: the key is wrong or was typed with a space. Re-enter it.
   - `openai http 404` or a message that the model does not exist or you lack access: the model id is wrong. Copy it again from your model list.
   - `openai http 429` / `insufficient_quota`: out of credit or rate limited. Check Billing.
   - `openai returned no text (finish_reason=length ...)`: some models spend the token cap on hidden reasoning. Set `$env:OPENAI_REASONING_EFFORT = "low"` and rerun, or pick a non-reasoning model.
   - `openai http 400 ... reasoning_effort` (unsupported parameter): clear it with `Remove-Item Env:OPENAI_REASONING_EFFORT`.
   - `openai http 400 ... response_format` (unsupported): set `$env:OPENAI_JSON_MODE = "0"`. The client still extracts the JSON from the reply and validates it.
   If it still fails, send me the `call:` lines and the failure line (never the key).
5. Real prices: copy them from OpenAI's pricing page (USD per million tokens) into `pricing.json` exactly as in Part 2A step 5, using your model id, then run `npm run cost -- --days 12 --budget 50 --model YOUR_MODEL_ID --pricing pricing.json`. OpenAI usually reports cached input separately; the adapter splits it out so it is priced at `cachedPerM`.


## Part 3: deploy the proxy to Supabase

The commands below are from my knowledge of the Supabase CLI and dashboard, and I could not run them. If a menu name or flag differs, tell me what you see.

1. Create a project at supabase.com. Save the **database password**. The **project ref** is the short id in the project URL.
2. In the repo root: `npx supabase login` (opens a browser), then `npx supabase init` (creates `supabase/config.toml`; keep the existing files), then `npx supabase link --project-ref YOUR_REF` (asks for the database password). Newer CLI versions target a local Docker database by default: add `--remote` to `db push`, `secrets set` and `functions deploy` if you see "Target: local stack". The SQL lines in steps 10 and 11 are SQL: run them in the dashboard SQL Editor, not in PowerShell.
3. Dashboard > **Authentication** > sign-in providers: turn on **Allow anonymous sign-ins** and click **Save**.
4. Create the tables: `npx supabase db push`. Then in the dashboard **Table Editor** confirm these tables exist: players, runs, run_bibles, story_seeds, saves, fingerprints, ghost_legends, daily_modifiers, llm_calls, llm_cache, content_gaps, budget. (Each should show RLS enabled.)
5. Store the secrets (these never go in the repo or the app). Set the model, the key for your provider and **the real prices** (the daily budget cap is computed from them; without them the proxy uses placeholder prices and logs a warning):
   - Anthropic: `npx supabase secrets set ANTHROPIC_API_KEY=your_key LLM_MODEL=model_id LLM_PRICE_IN_PER_M=0 LLM_PRICE_OUT_PER_M=0 LLM_PRICE_CACHED_PER_M=0`
   - OpenAI: `npx supabase secrets set LLM_PROVIDER=openai OPENAI_API_KEY=your_key LLM_MODEL=model_id LLM_PRICE_IN_PER_M=0 LLM_PRICE_OUT_PER_M=0 LLM_PRICE_CACHED_PER_M=0` (add `OPENAI_REASONING_EFFORT=low` or `OPENAI_JSON_MODE=0` only if Part 2B told you to)
   Replace each 0 price with the real USD-per-million-token number. Windows PowerShell: do not type the key into the command (it would be saved in your command history); build the argument from the variable you already loaded, e.g. `npx supabase secrets set "OPENAI_API_KEY=$env:OPENAI_API_KEY" LLM_PROVIDER=openai LLM_MODEL=model_id LLM_PRICE_IN_PER_M=... LLM_PRICE_OUT_PER_M=...`. On a recent CLI add `--remote` if it prints "Target: local stack".
   Changing a secret does not need a redeploy, but the next function call may take a moment to pick it up. If a call still falls back as `kill_switch` with no log rows, open Dashboard > Edge Functions > llm-proxy > Logs: a line starting `llm-proxy: model not configured:` names the missing secret.
6. Deploy: `npx supabase functions deploy llm-proxy`
7. Dashboard > **Project Settings > API**: copy the **Project URL** and the **anon public** key (the anon key is safe to use here; **never** use the service_role key in scripts).
8. Run the end-to-end check:
   - macOS / Linux: `SUPABASE_URL=https://YOUR_REF.supabase.co SUPABASE_ANON_KEY=your_anon_key npm run edge:smoke`
   - Windows PowerShell: `$env:SUPABASE_URL="https://YOUR_REF.supabase.co"; $env:SUPABASE_ANON_KEY="your_anon_key"; npm run edge:smoke`
   Expect steps 1 to 5 to print, then `PROXY SMOKE TEST PASSED (and the cache served the repeat call)`. On a current Supabase project the key you paste can be the **publishable** key (`sb_publishable_...`); the variable is still called `SUPABASE_ANON_KEY`. Never use the secret / service_role key.
   If it prints `NOTE: ... fallback`, the proxy works but the model is off or failing: check the secrets and the `llm_calls` table (columns `ok` and `error`).
9. Check the log: Table Editor > `llm_calls` should have rows with token counts and `cost_usd` (with real prices set in step 5, `cost_usd` should match your own arithmetic from the token counts; the repeat call in step 8 should add **no** new row because it was served from the cache). For a daily summary open the view `llm_spend_daily` (calls, failures, fallbacks, tokens, cost).
10. Test the kill switch (SQL Editor): `update public.budget set kill_switch = true where id = 1;` then rerun step 8: the answer must be `fallback` with reason `kill_switch` and **no new** `llm_calls` rows. Switch it back: `update public.budget set kill_switch = false where id = 1;`
11. Test the budget cap: `update public.budget set daily_cap_usd = 0.01 where id = 1;`, make a few calls, and confirm it falls back with reason `budget`. Restore with `set daily_cap_usd = 2.00`.

## Human verification checklist for M3

1. Part 1 is green on your machine.
2. You read 10 bibles (`npm run bibles`) and judged freshness. (The plan's formal "read 10 Run Bibles" is after M4, with real P2 output.)
3. You approve the sanitizer limits (120 characters, links and markup removed) and the proxy defaults in `src/proxy.ts`: 150 calls per player per day, 500 per run, $2 per day, reuse limits (dialogue 2).
4. You chose a provider and model and set a spend limit (Part 2A or 2B).
5. Supabase passed Part 3, including the kill switch and budget tests.
