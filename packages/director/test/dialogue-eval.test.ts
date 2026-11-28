import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PROXY_CONFIG, handleLlmRequest, LlmClient, MockProvider, sampleVars } from '../src/index.ts';
import type { ProxyStore } from '../src/index.ts';

class TestStore implements ProxyStore {
  cache = new Map<string, { json: unknown; hits: number }>();
  async status() { return { killSwitch: false, spentTodayUsd: 0 }; }
  async countPlayerCalls() { return 0; }
  async countRunCalls() { return 0; }
  async cacheGet(k: string) { return this.cache.get(k) ?? null; }
  async cachePut(k: string, json: unknown) { this.cache.set(k, { json, hits: 0 }); }
  async cacheHit(k: string) {
    const e = this.cache.get(k);
    if (e) e.hits++;
  }
  async logCalls() {}
  async addGaps() {}
}

test('T027: dialogue P4 caching respects reuse limit and reports hit rate', async () => {
  const store = new TestStore();
  let calls = 0;
  const provider = new MockProvider(() => {
    calls++;
    return JSON.stringify({
      lines: ['Hello traveller.'],
      mood: 'calm',
      memory_candidate: null,
      trust_delta: 0,
      reveals_clue_id: null,
      offers_action_id: null,
    });
  });
  const client = new LlmClient({ provider, model: 'm' });

  const req = {
    playerId: 'p1',
    runId: 'r1',
    promptId: 'P4',
    vars: sampleVars('P4'),
  };

  // Call 1: model call (miss)
  const r1 = await handleLlmRequest({ store, client, config: DEFAULT_PROXY_CONFIG }, req);
  assert.equal(r1.status, 'ok');
  if (r1.status === 'ok') assert.equal(r1.source, 'llm');
  assert.equal(calls, 1);

  // Call 2: cache hit 1 (reuse allowed up to 2)
  const r2 = await handleLlmRequest({ store, client, config: DEFAULT_PROXY_CONFIG }, req);
  assert.equal(r2.status, 'ok');
  if (r2.status === 'ok') assert.equal(r2.source, 'cache');
  assert.equal(calls, 1);

  // Call 3: cache hit 2
  const r3 = await handleLlmRequest({ store, client, config: DEFAULT_PROXY_CONFIG }, req);
  assert.equal(r3.status, 'ok');
  if (r3.status === 'ok') assert.equal(r3.source, 'cache');
  assert.equal(calls, 1);

  // Call 4: exceeded cache reuse of 2 -> model regenerated
  const r4 = await handleLlmRequest({ store, client, config: DEFAULT_PROXY_CONFIG }, req);
  assert.equal(r4.status, 'ok');
  if (r4.status === 'ok') assert.equal(r4.source, 'llm');
  assert.equal(calls, 2);
});
