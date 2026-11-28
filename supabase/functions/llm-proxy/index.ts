// Supabase Edge Function (Deno): the only place the LLM key lives.
// NOT executed in the build sandbox (no Deno). The logic it calls (../_shared/director/proxy.ts) is fully tested.
// Deploy:  supabase functions deploy llm-proxy
// Secrets: LLM_MODEL plus ANTHROPIC_API_KEY (default) or LLM_PROVIDER=openai with OPENAI_API_KEY  (see docs/VERIFY_M3.md)
// deno-lint-ignore-file no-explicit-any
// @ts-nocheck
import { createClient } from 'npm:@supabase/supabase-js@2';
import { handleLlmRequest, DEFAULT_PROXY_CONFIG } from '../_shared/director/proxy.ts';
import { LlmClient, providerFromEnv } from '../_shared/director/client.ts';
import { pricingFromEnv } from '../_shared/director/cost.ts';

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type', 'access-control-allow-methods': 'POST, OPTIONS' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json' } });

class SupabaseStore {
  constructor(private db: any) {}
  async status(dayKey: string) {
    const { data: b } = await this.db.from('budget').select('kill_switch, daily_cap_usd').eq('id', 1).single();
    const { data: rows } = await this.db.from('llm_calls').select('cost_usd').eq('day', dayKey);
    const spent = (rows ?? []).reduce((a: number, r: any) => a + Number(r.cost_usd), 0);
    return { killSwitch: !!b?.kill_switch, spentTodayUsd: spent, dailyCapUsd: b ? Number(b.daily_cap_usd) : null };
  }
  async countPlayerCalls(playerId: string, dayKey: string) {
    const { count } = await this.db.from('llm_calls').select('id', { count: 'exact', head: true }).eq('player_id', playerId).eq('day', dayKey);
    return count ?? 0;
  }
  async countRunCalls(runId: string) {
    const { count } = await this.db.from('llm_calls').select('id', { count: 'exact', head: true }).eq('run_id', runId);
    return count ?? 0;
  }
  async cacheGet(key: string) {
    const { data } = await this.db.from('llm_cache').select('json, hits').eq('key', key).maybeSingle();
    return data ? { json: data.json, hits: data.hits } : null;
  }
  async cachePut(key: string, j: unknown) {
    await this.db.from('llm_cache').upsert({ key, json: j, hits: 0 });
  }
  async cacheHit(key: string) {
    await this.db.rpc('bump_cache_hit', { p_key: key });
  }
  async logCalls(playerId: string, runId: string, dayKey: string, records: any[]) {
    if (!records.length) return;
    await this.db.from('llm_calls').insert(records.map((r) => ({
      day: dayKey, player_id: playerId, run_id: runId, prompt_id: r.promptId, prompt_version: r.promptVersion, model: r.model,
      tokens_in: r.tokensIn, tokens_out: r.tokensOut, tokens_cached: r.tokensCached, cost_usd: r.costUsd, latency_ms: r.latencyMs, ok: r.ok, fallback_used: r.fallbackUsed, error: r.error,
    })));
  }
  async addGaps(gaps: string[], promptId: string) {
    for (const g of gaps) await this.db.rpc('bump_content_gap', { p_gap: g.slice(0, 300), p_prompt: promptId });
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ status: 'rejected', reason: 'bad_request', detail: 'POST only' }, 405);

  // 1. who is calling? (the platform already checked the JWT signature; we need the user id)
  const url = Deno.env.get('SUPABASE_URL')!;
  const authHeader = req.headers.get('Authorization') ?? '';
  const asUser = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } });
  const { data: userData, error: userErr } = await asUser.auth.getUser();
  if (userErr || !userData?.user) return json({ status: 'rejected', reason: 'bad_request', detail: 'not signed in' }, 401);
  const playerId = userData.user.id;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ status: 'rejected', reason: 'bad_request', detail: 'invalid JSON' }, 400);
  }

  // 2. service-role client for budget, logs and cache (never exposed to the app)
  const db = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // 3. the run must belong to this player
  const { data: run } = await db.from('runs').select('id').eq('id', body?.run_id).eq('player_id', playerId).maybeSingle();
  if (!run) return json({ status: 'rejected', reason: 'bad_request', detail: 'unknown run' }, 403);

  const setup = providerFromEnv((name) => Deno.env.get(name));
  if ('error' in setup) {
    // not configured: behave like the kill switch for the player, but say why in the function logs (Dashboard > Edge Functions > llm-proxy > Logs)
    console.error(`llm-proxy: model not configured: ${setup.error}`);
    return json({ status: 'fallback', reason: 'kill_switch' });
  }

  const store = new SupabaseStore(db);
  const st = await store.status(new Date().toISOString().slice(0, 10));
  const config = { ...DEFAULT_PROXY_CONFIG, dailyBudgetUsd: st.dailyCapUsd ?? DEFAULT_PROXY_CONFIG.dailyBudgetUsd };
  // real prices keep cost_usd (and therefore the daily budget cap) honest; without them the placeholder prices are used
  const pricing = pricingFromEnv((name) => Deno.env.get(name));
  if (!pricing) console.warn('llm-proxy: LLM_PRICE_IN_PER_M / LLM_PRICE_OUT_PER_M not set, using placeholder prices: cost_usd and the budget cap are not real');
  const client = new LlmClient({ provider: setup.provider, model: setup.model, ...(pricing ? { pricing } : {}) });
  const result = await handleLlmRequest({ store, client, config, killSwitch: Deno.env.get('KILL_SWITCH') === '1' }, { playerId, runId: body.run_id, promptId: body.prompt_id, vars: body.vars });
  return json(result, result.status === 'rejected' ? 400 : 200);
});
