import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { AnthropicProvider, LlmClient, MockProvider, REGISTRY, renderPrompt, extractJson, costUsd, summarize, validate, PRICING_PLACEHOLDER } from '../src/index.ts';
import type { PromptId } from '../src/index.ts';
import { fallbackDirector } from '../src/director.ts';
import { newState, content, lore, sampleVars, OUTPUT_FIXTURES } from './fixtures.ts';

const IDS = Object.keys(REGISTRY) as PromptId[];

function fixtureFor(id: PromptId): unknown {
  if (id === 'P2') return newState(3).bible;
  if (id === 'P3') {
    const { state, bible } = newState(3);
    return fallbackDirector({ state, content, lore, bible, memory: { beats: [], stanceCounts: { mirror: 0, challenge: 0, wildcard: 0 }, foreshadowed: false }, decision: { kind: 'day_start', day: 1 }, seed: 3 });
  }
  return OUTPUT_FIXTURES[id as keyof typeof OUTPUT_FIXTURES];
}

test('the generated prompt file is in sync with docs/PROMPTS.md', () => {
  execFileSync('node', [join(import.meta.dirname, '..', 'scripts', 'gen-prompts.ts'), '--check'], { stdio: 'pipe' });
});

test('registry has P1 to P9 (P7 split in two), versioned, each with variables and a token cap', () => {
  assert.deepEqual(IDS.sort(), ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7a', 'P7b', 'P8', 'P9']);
  for (const id of IDS) {
    assert.equal(REGISTRY[id].version, '1');
    assert.ok(REGISTRY[id].vars.length >= 1, id);
    assert.ok(REGISTRY[id].maxTokens >= 200, id);
  }
  assert.ok(REGISTRY.P3.usesConstitution && REGISTRY.P4.usesConstitution);
  assert.ok(!REGISTRY.P8.usesConstitution && !REGISTRY.P9.usesConstitution);
});

test('every prompt renders with no placeholder left, and the constitution goes in the stable system prefix', () => {
  for (const id of IDS) {
    const r = renderPrompt(id, sampleVars(id));
    assert.ok(!/\{\{\w+\}\}/.test(r.prompt + r.system), `${id} has an unfilled placeholder`);
    if (REGISTRY[id].usesConstitution) assert.ok(r.system.includes('Hollowmere'), `${id} system prefix`);
    else assert.equal(r.system, '');
  }
});

test('rendering rejects missing and unknown variables; values are never re-scanned for placeholders', () => {
  const vars = sampleVars('P4');
  const { npc_name: _n, ...missing } = vars;
  assert.throws(() => renderPrompt('P4', missing), /missing variable\(s\) npc_name/);
  assert.throws(() => renderPrompt('P4', { ...vars, bogus: 1 }), /unknown variable\(s\) bogus/);
  const r = renderPrompt('P4', { ...vars, player_intent: 'x {{npc_card}} {{trust}} y' });
  assert.ok(r.prompt.includes('x {{npc_card}} {{trust}} y'));
});

test('all prompts run end to end against fixtures in mock mode (T017 check)', async () => {
  for (const id of IDS) {
    const fx = fixtureFor(id);
    assert.deepEqual(validate(REGISTRY[id].schema, fx), [], `${id} fixture must satisfy its schema`);
    const client = new LlmClient({ provider: new MockProvider(() => JSON.stringify(fx)), model: 'mock-model' });
    const res = await client.complete(id, sampleVars(id));
    assert.ok(res.ok, `${id}: ${res.ok ? '' : res.detail}`);
    assert.equal(res.records.length, 1);
  }
});

test('schemas reject the obvious corruptions of every fixture', () => {
  for (const id of IDS) {
    const fx = JSON.parse(JSON.stringify(fixtureFor(id))) as Record<string, unknown>;
    const key = Object.keys(fx)[0]!;
    const { [key]: _gone, ...without } = fx;
    assert.ok(validate(REGISTRY[id].schema, without).length > 0, `${id}: missing key accepted`);
    assert.ok(validate(REGISTRY[id].schema, { ...fx, surprise: 1 }).length > 0, `${id}: extra key accepted`);
    assert.ok(validate(REGISTRY[id].schema, 'nope').length > 0, `${id}: non-object accepted`);
  }
  const p4 = { ...(OUTPUT_FIXTURES.P4 as object) } as Record<string, unknown>;
  assert.ok(validate(REGISTRY.P4.schema, { ...p4, trust_delta: 5 }).length > 0);
  assert.ok(validate(REGISTRY.P4.schema, { ...p4, trust_delta: 0.5 }).length > 0);
  assert.ok(validate(REGISTRY.P4.schema, { ...p4, mood: 'ecstatic' }).length > 0);
  assert.ok(validate(REGISTRY.P4.schema, { ...p4, lines: [] }).length > 0);
  assert.ok(validate(REGISTRY.P4.schema, { ...p4, lines: ['a', 'b', 'c'] }).length > 0);
});

/* ───────────── client behaviour ───────────── */

test('extractJson tolerates code fences and chatter, and rejects non-JSON', () => {
  assert.deepEqual(extractJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(extractJson('Sure! Here you go: {"a":{"b":2}} Hope that helps.'), { a: { b: 2 } });
  assert.throws(() => extractJson('no json here'));
  assert.throws(() => extractJson('{broken'));
});

test('one retry with a stricter note on invalid JSON, then success; both attempts are logged', async () => {
  const provider = new MockProvider((_r, i) => (i === 0 ? 'I think the answer is...' : JSON.stringify(OUTPUT_FIXTURES.P6)));
  const client = new LlmClient({ provider, model: 'm' });
  const res = await client.complete('P6', sampleVars('P6'));
  assert.ok(res.ok);
  assert.equal(provider.calls.length, 2);
  assert.match(provider.calls[1]!.prompt, /not valid JSON/);
  assert.deepEqual(res.records.map((r) => r.ok), [false, true]);
});

test('off-schema output gets one retry, then fails with invalid_schema (never a third call)', async () => {
  const provider = new MockProvider(() => JSON.stringify({ ...(OUTPUT_FIXTURES.P6 as object), modifier_id: 7 }));
  const res = await new LlmClient({ provider, model: 'm' }).complete('P6', sampleVars('P6'));
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.reason, 'invalid_schema');
  assert.equal(provider.calls.length, 2);
});

test('timeouts are not retried; provider errors are retried once', async () => {
  const slow = new MockProvider(() => new Promise<string>(() => {}));
  const t = await new LlmClient({ provider: slow, model: 'm', timeoutMs: 20 }).complete('P6', sampleVars('P6'));
  assert.equal(t.ok, false);
  if (!t.ok) assert.equal(t.reason, 'timeout');
  assert.equal(slow.calls.length, 1);

  const flaky = new MockProvider((_r, i) => {
    if (i === 0) throw new Error('503 overloaded');
    return JSON.stringify(OUTPUT_FIXTURES.P6);
  });
  const ok = await new LlmClient({ provider: flaky, model: 'm' }).complete('P6', sampleVars('P6'));
  assert.ok(ok.ok);
  assert.equal(flaky.calls.length, 2);

  const dead = new MockProvider(() => {
    throw new Error('500');
  });
  const bad = await new LlmClient({ provider: dead, model: 'm' }).complete('P6', sampleVars('P6'));
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.equal(bad.reason, 'provider_error');
  assert.equal(dead.calls.length, 2);
});

test('token caps are passed through and usage is costed', async () => {
  const provider = new MockProvider(() => JSON.stringify(OUTPUT_FIXTURES.P6));
  const res = await new LlmClient({ provider, model: 'm' }).complete('P6', sampleVars('P6'));
  assert.equal(provider.calls[0]!.maxTokens, REGISTRY.P6.maxTokens);
  assert.ok(res.ok && res.records[0]!.tokensIn > 0 && res.records[0]!.tokensOut > 0 && res.records[0]!.costUsd > 0);
});

/* ───────────── Anthropic adapter (fake fetch; the live call needs a key, see docs/VERIFY_M3.md) ───────────── */

test('AnthropicProvider sends the documented request shape and maps usage', async () => {
  let seen: { url: string; init: RequestInit } | null = null;
  const fake = (async (url: string, init: RequestInit) => {
    seen = { url, init };
    return new Response(JSON.stringify({ content: [{ type: 'text', text: '{"ok":true}' }], usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 900, cache_creation_input_tokens: 50 } }), { status: 200 });
  }) as unknown as typeof fetch;
  const p = new AnthropicProvider({ apiKey: 'sk-test', fetchImpl: fake });
  const out = await p.call({ model: 'some-model', system: 'SYSTEM', prompt: 'PROMPT', maxTokens: 300 });
  assert.equal(out.text, '{"ok":true}');
  assert.deepEqual(out.usage, { inputTokens: 150, outputTokens: 20, cachedTokens: 900 });
  const s = seen as unknown as { url: string; init: RequestInit };
  assert.equal(s.url, 'https://api.anthropic.com/v1/messages');
  const h = s.init.headers as Record<string, string>;
  assert.equal(h['x-api-key'], 'sk-test');
  assert.equal(h['anthropic-version'], '2023-06-01');
  const body = JSON.parse(s.init.body as string);
  assert.equal(body.model, 'some-model');
  assert.equal(body.max_tokens, 300);
  assert.deepEqual(body.messages, [{ role: 'user', content: 'PROMPT' }]);
  assert.deepEqual(body.system, [{ type: 'text', text: 'SYSTEM', cache_control: { type: 'ephemeral' } }]);
});

test('AnthropicProvider omits system when empty, surfaces HTTP errors, and requires a key', async () => {
  let body: Record<string, unknown> = {};
  const ok = (async (_u: string, init: RequestInit) => {
    body = JSON.parse(init.body as string);
    return new Response(JSON.stringify({ content: [{ type: 'text', text: '{}' }] }), { status: 200 });
  }) as unknown as typeof fetch;
  await new AnthropicProvider({ apiKey: 'k', fetchImpl: ok }).call({ model: 'm', system: '', prompt: 'p', maxTokens: 10 });
  assert.ok(!('system' in body));
  const err = (async () => new Response('rate limited', { status: 429 })) as unknown as typeof fetch;
  await assert.rejects(new AnthropicProvider({ apiKey: 'k', fetchImpl: err }).call({ model: 'm', system: '', prompt: 'p', maxTokens: 10 }), /anthropic http 429/);
  assert.throws(() => new AnthropicProvider({ apiKey: '' }), /apiKey is required/);
});

/* ───────────── cost ───────────── */

test('cost math and summaries', () => {
  const pricing = { default: { inPerM: 1, outPerM: 5, cachedPerM: 0.1 }, models: { big: { inPerM: 10, outPerM: 50, cachedPerM: 1 } } };
  assert.equal(costUsd({ inputTokens: 1_000_000, outputTokens: 1_000_000, cachedTokens: 1_000_000 }, 'x', pricing), 6.1);
  assert.equal(costUsd({ inputTokens: 1_000_000, outputTokens: 0, cachedTokens: 0 }, 'big', pricing), 10);
  assert.equal(costUsd({ inputTokens: 0, outputTokens: 0, cachedTokens: 0 }, 'x', PRICING_PLACEHOLDER), 0);
  const rec = (p: string, cost: number, ok = true, fb = false) => ({ promptId: p, promptVersion: '1', model: 'm', tokensIn: 10, tokensOut: 5, tokensCached: 1, costUsd: cost, latencyMs: 100, ok, fallbackUsed: fb, error: null });
  const s = summarize([rec('P3', 0.01), rec('P4', 0.002), rec('P4', 0.002, false, true)]);
  assert.equal(s.calls, 3);
  assert.equal(s.failed, 1);
  assert.equal(s.fallbacks, 1);
  assert.equal(s.costUsd, 0.014);
  assert.deepEqual(s.byPrompt['P4'], { calls: 2, costUsd: 0.004 });
});
