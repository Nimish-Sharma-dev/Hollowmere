// Usage: SUPABASE_URL=https://<ref>.supabase.co SUPABASE_ANON_KEY=<anon key> node packages/director/scripts/edge-smoke.ts
// End-to-end check of the deployed proxy: anonymous sign-in -> create player + run -> call llm-proxy twice.
// Uses only the PUBLIC anon key (never the service role key or the LLM key). NOT run in the build sandbox.
export {};
const url = process.env["SUPABASE_URL"];
const anon = process.env['SUPABASE_ANON_KEY'];
if (!url || !anon) {
  console.error('Set SUPABASE_URL and SUPABASE_ANON_KEY (Project Settings > API in the Supabase dashboard).');
  process.exit(2);
}
async function call(path: string, init: RequestInit & { token?: string }): Promise<{ status: number; body: any }> {
  const res = await fetch(`${url}${path}`, { ...init, headers: { apikey: anon!, 'content-type': 'application/json', ...(init.token ? { authorization: `Bearer ${init.token}` } : {}), ...(init.headers as Record<string, string> | undefined) } });
  const text = await res.text();
  let body: any = text;
  try { body = JSON.parse(text); } catch { /* keep text */ }
  return { status: res.status, body };
}
function must(cond: unknown, msg: string, extra?: unknown): asserts cond {
  if (!cond) {
    console.error(`FAILED: ${msg}`, extra === undefined ? '' : JSON.stringify(extra));
    process.exit(1);
  }
}

const signup = await call('/auth/v1/signup', { method: 'POST', body: '{}' });
must(signup.status === 200 && signup.body.access_token, 'anonymous sign-in failed (is "Allow anonymous sign-ins" switched on?)', signup);
const token: string = signup.body.access_token;
const userId: string = signup.body.user.id;
console.log('1. anonymous player signed in:', userId);

const player = await call('/rest/v1/players', { method: 'POST', token, body: JSON.stringify({ id: userId }), headers: { prefer: 'return=representation' } });
must(player.status === 201, 'could not create the player row (did the migration run?)', player);
const run = await call('/rest/v1/runs', { method: 'POST', token, body: JSON.stringify({ player_id: userId, seed: 1 }), headers: { prefer: 'return=representation' } });
must(run.status === 201 && run.body[0]?.id, 'could not create the run row', run);
const runId: string = run.body[0].id;
console.log('2. player and run rows created (row level security allowed them):', runId);

const vars = { modifier_library: [{ id: 'low_fog', name: 'Low fog' }, { id: 'bright_cold', name: 'Bright cold' }], last_seven_modifiers: [], date: '2026-01-01', seed_draw: { lens: 'mystery', weather_season: 'first_snow' } };
const first = await call('/functions/v1/llm-proxy', { method: 'POST', token, body: JSON.stringify({ run_id: runId, prompt_id: 'P6', vars }) });
console.log('3. first proxy call:', first.status, JSON.stringify(first.body));
must(first.status === 200, 'proxy did not answer 200', first);
const second = await call('/functions/v1/llm-proxy', { method: 'POST', token, body: JSON.stringify({ run_id: runId, prompt_id: 'P6', vars }) });
console.log('4. second identical call:', second.status, JSON.stringify(second.body));
must(second.status === 200, 'second call failed', second);
const bad = await call('/functions/v1/llm-proxy', { method: 'POST', token, body: JSON.stringify({ run_id: runId, prompt_id: 'P99', vars: {} }) });
must(bad.status === 400, 'a bad prompt id should be rejected with 400', bad);
console.log('5. bad request rejected as expected (400)');
if (first.body.status === 'fallback') console.log(`NOTE: the proxy answered "fallback" (${first.body.reason}). That is a working proxy with the model switched off or failing; check the secrets and the llm_calls table.`);
else console.log('PROXY SMOKE TEST PASSED' + (second.body.source === 'cache' ? ' (and the cache served the repeat call)' : ''));
