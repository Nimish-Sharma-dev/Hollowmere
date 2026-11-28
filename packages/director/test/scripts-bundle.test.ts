import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..', '..', '..');
const script = (name: string, args: string[] = []): string => execFileSync('node', [join(root, 'packages', 'director', 'scripts', name), ...args], { encoding: 'utf8' });

test('the edge bundle is in sync with the sources, and the proxy imports nothing outside it', () => {
  script('build-edge.ts', ['--check']);
  const files = ['proxy.ts', 'client.ts', 'cost.ts', 'prompts.ts', 'prompts.generated.ts', 'schema.ts', 'schemas.ts'];
  const allowed = new Set(files);
  for (const f of files) {
    const code = readFileSync(join(root, 'packages', 'director', 'src', f), 'utf8');
    assert.ok(!/from\s+['"]node:/.test(code), `${f} imports a node builtin`);
    for (const m of code.matchAll(/from\s+'(\.[^']+)'/g)) assert.ok(allowed.has(m[1]!.replace('./', '')), `${f} imports ${m[1]} which is not in the edge bundle`);
    assert.ok(existsSync(join(root, 'supabase', 'functions', '_shared', 'director', f)));
  }
});

test('the Edge Function and migration files exist and mention what the proxy needs', () => {
  const fn = readFileSync(join(root, 'supabase', 'functions', 'llm-proxy', 'index.ts'), 'utf8');
  for (const needle of ['handleLlmRequest', 'ANTHROPIC_API_KEY', 'LLM_MODEL', 'auth.getUser', 'SUPABASE_SERVICE_ROLE_KEY', 'KILL_SWITCH']) assert.ok(fn.includes(needle), needle);
  const sql = readFileSync(join(root, 'supabase', 'migrations', '20260101000000_init.sql'), 'utf8');
  for (const t of ['players', 'runs', 'run_bibles', 'story_seeds', 'saves', 'fingerprints', 'ghost_legends', 'daily_modifiers', 'llm_calls', 'llm_cache', 'content_gaps', 'budget']) {
    assert.match(sql, new RegExp(`create table public\\.${t}\\b`), `table ${t}`);
    assert.match(sql, new RegExp(`alter table public\\.${t} enable row level security`), `RLS on ${t}`);
  }
  assert.match(sql, /create or replace view public\.llm_spend_daily/);
  assert.match(sql, /revoke all on public\.llm_spend_daily from anon, authenticated/);
  // the proxy's columns line up with what the function inserts
  for (const col of ['prompt_id', 'prompt_version', 'tokens_in', 'tokens_out', 'tokens_cached', 'cost_usd', 'latency_ms', 'fallback_used']) assert.ok(sql.includes(col) && fn.includes(col), col);
});

test('T022: the cost script prints cost per run, per day, and runs per budget', () => {
  const out = script('cost.ts', ['--days', '10', '--budget', '50']);
  assert.match(out, /cost per run:\s+\$\d+\.\d{4}/);
  assert.match(out, /cost per game day:\s+\$\d+\.\d{4}/);
  assert.match(out, /runs per \$50:\s+\d+/);
  assert.match(out, /PLACEHOLDER/);
  assert.match(out, /P3 director \(measured\)/);
});

test('the sim script reports a passing T019 summary for a small run', () => {
  const out = script('sim.ts', ['40', '2']);
  assert.match(out, /invalid bibles\s+0/);
  assert.match(out, /invariant violations 0/);
  assert.match(out, /divergence gate\s+PASS/);
});

test('the smoke script refuses to run without a key (exit code 2) instead of calling anything', () => {
  let code = 0;
  try {
    execFileSync('node', [join(root, 'packages', 'director', 'scripts', 'llm-smoke.ts')], { encoding: 'utf8', stdio: 'pipe', env: { ...process.env, LLM_PROVIDER: '', ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '', LLM_MODEL: '' } });
  } catch (e) {
    code = (e as { status: number }).status;
  }
  assert.equal(code, 2);
});

test('the Supabase smoke script refuses to run without its environment (exit code 2) instead of calling anything', () => {
  let code = 0;
  try {
    execFileSync('node', [join(root, 'packages', 'director', 'scripts', 'edge-smoke.ts')], { encoding: 'utf8', stdio: 'pipe', env: { ...process.env, SUPABASE_URL: '', SUPABASE_ANON_KEY: '' } });
  } catch (e) {
    code = (e as { status: number }).status;
  }
  assert.equal(code, 2);
});
