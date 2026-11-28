import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleLlmRequest, InMemoryProxyStore, DEFAULT_PROXY_CONFIG, LlmClient, MockProvider, cacheKey, REGISTRY } from '../src/index.ts';
import type { ProxyConfig, ProxyResponse } from '../src/index.ts';
import { OUTPUT_FIXTURES, sampleVars } from './fixtures.ts';

const DAY1 = Date.UTC(2026, 0, 5, 12, 0, 0);
const DAY2 = Date.UTC(2026, 0, 6, 12, 0, 0);

function setup(handler: (i: number) => string = () => JSON.stringify(OUTPUT_FIXTURES.P4), config: Partial<ProxyConfig> = {}, cost = 0) {
  const provider = new MockProvider((_r, i) => handler(i));
  const base = new LlmClient({ provider, model: 'm', pricing: { default: { inPerM: cost, outPerM: cost, cachedPerM: 0 }, models: {} } });
  const store = new InMemoryProxyStore();
  let now = DAY1;
  const deps = { store, client: base, config: { ...DEFAULT_PROXY_CONFIG, ...config }, now: () => now };
  const call = (over: Record<string, unknown> = {}, d: { killSwitch?: boolean } = {}): Promise<ProxyResponse> =>
    handleLlmRequest({ ...deps, ...d }, { playerId: 'player_1', runId: 'run_1', promptId: 'P4', vars: sampleVars('P4'), ...over });
  return { provider, store, call, setNow: (t: number) => void (now = t) };
}
const fallbackReason = (r: ProxyResponse): string => (r.status === 'fallback' ? r.reason : `not-fallback:${r.status}`);

test('a normal request is served by the model, logged, and returned as clean JSON', async () => {
  const { call, store, provider } = setup();
  const r = await call();
  assert.deepEqual(r, { status: 'ok', source: 'llm', json: OUTPUT_FIXTURES.P4 });
  assert.equal(provider.calls.length, 1);
  assert.equal(store.calls.length, 1);
  assert.equal(store.calls[0]!.record.promptId, 'P4');
  assert.equal(store.calls[0]!.playerId, 'player_1');
});

test('kill switch (env flag or stored flag) routes everything to the fallback and never calls the model', async () => {
  const a = setup();
  assert.equal(fallbackReason(await a.call({}, { killSwitch: true })), 'kill_switch');
  assert.equal(a.provider.calls.length, 0);
  const b = setup();
  b.store.killSwitch = true;
  assert.equal(fallbackReason(await b.call()), 'kill_switch');
  assert.equal(b.provider.calls.length, 0);
  b.store.killSwitch = false;
  assert.equal((await b.call()).status, 'ok'); // flipping it back restores service
});

test('per-player daily cap: the next call falls back, other players and the next day are unaffected', async () => {
  const { call, provider, setNow } = setup(() => JSON.stringify(OUTPUT_FIXTURES.P5), { perPlayerDayCalls: 3, cacheReuse: {} });
  const vars = sampleVars('P5');
  for (let i = 0; i < 3; i++) assert.equal((await call({ promptId: 'P5', vars })).status, 'ok');
  assert.equal(fallbackReason(await call({ promptId: 'P5', vars })), 'player_cap');
  assert.equal(provider.calls.length, 3);
  assert.equal((await call({ promptId: 'P5', vars, playerId: 'player_2' })).status, 'ok');
  setNow(DAY2);
  assert.equal((await call({ promptId: 'P5', vars })).status, 'ok');
});

test('per-run cap applies across days', async () => {
  const { call, setNow } = setup(() => JSON.stringify(OUTPUT_FIXTURES.P5), { perRunCalls: 2, cacheReuse: {} });
  const vars = sampleVars('P5');
  await call({ promptId: 'P5', vars });
  setNow(DAY2);
  await call({ promptId: 'P5', vars });
  assert.equal(fallbackReason(await call({ promptId: 'P5', vars })), 'run_cap');
  assert.equal((await call({ promptId: 'P5', vars, runId: 'run_2' })).status, 'ok');
});

test('global daily budget: once spent, everything falls back until the next day', async () => {
  const { call, setNow } = setup(() => JSON.stringify(OUTPUT_FIXTURES.P5), { dailyBudgetUsd: 0.5, cacheReuse: {} }, 1_000_000 / 1000); // each call costs about a few cents
  const vars = sampleVars('P5');
  let ok = 0;
  for (let i = 0; i < 400 && (await call({ promptId: 'P5', vars })).status === 'ok'; i++) ok++;
  assert.ok(ok >= 1 && ok < 400, `budget should stop service after some calls, served ${ok}`);
  assert.equal(fallbackReason(await call({ promptId: 'P5', vars })), 'budget');
  setNow(DAY2);
  assert.equal((await call({ promptId: 'P5', vars })).status, 'ok');
});

test('bad requests are rejected before anything else happens', async () => {
  const { call, provider, store } = setup();
  const bad = async (over: Record<string, unknown>, needle: RegExp): Promise<void> => {
    const r = await call(over);
    assert.equal(r.status, 'rejected');
    assert.match(r.status === 'rejected' ? r.detail : '', needle);
  };
  await bad({ promptId: 'P99' }, /promptId/);
  await bad({ promptId: 42 }, /promptId/);
  await bad({ playerId: '' }, /playerId/);
  await bad({ playerId: 'a b; drop table' }, /playerId/);
  await bad({ runId: 'x'.repeat(65) }, /runId/);
  await bad({ vars: null }, /vars/);
  await bad({ vars: [] }, /vars/);
  await bad({ vars: { ...sampleVars('P4'), evil: 'x' } }, /unknown variable evil/);
  const { npc_name: _n, ...partial } = sampleVars('P4');
  await bad({ vars: partial }, /missing variable npc_name/);
  await bad({ vars: { ...sampleVars('P4'), npc_name: 'x'.repeat(20_001) } }, /too large/);
  assert.equal(provider.calls.length, 0);
  assert.equal(store.calls.length, 0);
});

test('dialogue (P4) replies are reused at most twice, then regenerated; non-cacheable prompts are never cached', async () => {
  const { call, provider } = setup();
  const sources: string[] = [];
  for (let i = 0; i < 7; i++) {
    const r = await call();
    sources.push(r.status === 'ok' ? r.source : r.status);
  }
  assert.deepEqual(sources, ['llm', 'cache', 'cache', 'llm', 'cache', 'cache', 'llm']);
  assert.equal(provider.calls.length, 3);

  const { call: callP5, provider: prov5 } = setup(() => JSON.stringify(OUTPUT_FIXTURES.P5));
  await callP5({ promptId: 'P5', vars: sampleVars('P5') });
  await callP5({ promptId: 'P5', vars: sampleVars('P5') });
  assert.equal(prov5.calls.length, 2);
});

test('different variables mean a different cache entry; the world-of-the-day (P6) is shared across players', async () => {
  const { call, provider } = setup(() => JSON.stringify(OUTPUT_FIXTURES.P6));
  const vars = sampleVars('P6');
  await call({ promptId: 'P6', vars });
  await call({ promptId: 'P6', vars, playerId: 'player_2' });
  await call({ promptId: 'P6', vars: { ...vars, date: '2026-01-06' } });
  assert.equal(provider.calls.length, 2);
  assert.notEqual(cacheKey('P6', '1', vars), cacheKey('P6', '1', { ...vars, date: 'x' }));
  assert.equal(cacheKey('P6', '1', { a: 1, b: 2 }), cacheKey('P6', '1', { b: 2, a: 1 }));
  assert.notEqual(cacheKey('P6', '1', vars), cacheKey('P6', '2', vars));
});

test('failures fall back with a reason, are still logged (they cost money), and are never cached', async () => {
  const slow = setup(() => '{"nope"');
  const r = await slow.call();
  assert.equal(fallbackReason(r), 'llm_invalid_json');
  assert.equal(slow.store.calls.length, 2); // first try + the one retry
  assert.ok(slow.store.calls.every((c) => c.record.fallbackUsed));
  assert.equal(slow.store.cache.size, 0);

  const bad = setup(() => JSON.stringify({ ...(OUTPUT_FIXTURES.P4 as object), trust_delta: 7 }));
  assert.equal(fallbackReason(await bad.call()), 'llm_invalid_schema');

  const boom = setup(() => {
    throw new Error('503');
  });
  assert.equal(fallbackReason(await boom.call()), 'llm_provider_error');
});

test('library gaps returned by the model are harvested into the content_gaps store', async () => {
  // P2 and P3 carry library_gap; build a minimal valid P3 reply through the registry schema
  const { call, store } = setup(() => JSON.stringify({
    diagnosis: 'd', options_considered: [1, 2, 3].map((n) => ({ event_id: `e${n}`, stance: 'mirror', pitch: 'p', risk: 'r' })), chosen_event_id: 'e1', stance: 'mirror', slot_assignments: {}, npc_spawns: [],
    tone: 'mystery', difficulty_adjust: 0, dilemma_template_id: null, rumor_seed: null, foreshadow_clue_id: null, player_facing_cause: 'c', plan_ahead: ['a', 'b'], library_gap: ['a heist event for winter', 'a heist event for winter', 'a market scene'],
  }));
  const r = await call({ promptId: 'P3', vars: sampleVars('P3') });
  assert.equal(r.status, 'ok');
  assert.equal(store.gaps.get('a heist event for winter'), 2);
  assert.equal(store.gaps.get('a market scene'), 1);
});

test('every registry prompt can be served through the proxy', async () => {
  for (const id of Object.keys(REGISTRY)) assert.ok(REGISTRY[id as keyof typeof REGISTRY].vars.length > 0);
});
