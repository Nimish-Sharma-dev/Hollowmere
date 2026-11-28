import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AnthropicProvider, LlmClient, OpenAIProvider, providerFromEnv, pricingFromEnv, costUsd, makeLore, lintLore, validateRunBible, twistHolders, buildFallbackBible } from '../src/index.ts';
import { content, lore, newBible } from './fixtures.ts';

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const reply = (body: unknown, status = 200): typeof fetch => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
const chatOk = (text: string, usage?: unknown): unknown => ({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: text } }], usage });

/* ───────────── OpenAI adapter (fake fetch; the live call needs a key, see docs/VERIFY_M3.md Part 2B) ───────────── */

test('OpenAIProvider sends the Chat Completions request shape and maps usage (cached tokens are split out of the prompt tokens)', async () => {
  let seen: { url: string; init: RequestInit } | null = null;
  const fake = (async (url: string, init: RequestInit) => {
    seen = { url, init };
    return new Response(JSON.stringify(chatOk('{"ok":true}', { prompt_tokens: 1000, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 900 } })), { status: 200 });
  }) as unknown as typeof fetch;
  const p = new OpenAIProvider({ apiKey: 'sk-test', fetchImpl: fake });
  const out = await p.call({ model: 'some-model', system: 'SYSTEM', prompt: 'PROMPT', maxTokens: 300 });
  assert.equal(out.text, '{"ok":true}');
  assert.deepEqual(out.usage, { inputTokens: 100, outputTokens: 20, cachedTokens: 900 });
  const s = seen as unknown as { url: string; init: RequestInit };
  assert.equal(s.url, 'https://api.openai.com/v1/chat/completions');
  const h = s.init.headers as Record<string, string>;
  assert.equal(h['authorization'], 'Bearer sk-test');
  const body = JSON.parse(s.init.body as string);
  assert.equal(body.model, 'some-model');
  assert.equal(body.max_completion_tokens, 300);
  assert.ok(!('max_tokens' in body), 'max_tokens is deprecated');
  assert.deepEqual(body.messages, [{ role: 'system', content: 'SYSTEM' }, { role: 'user', content: 'PROMPT' }]);
  assert.deepEqual(body.response_format, { type: 'json_object' });
  assert.ok(!('reasoning_effort' in body) && !('temperature' in body));
});

test('OpenAIProvider options: no system message when empty, JSON mode off, reasoning effort and base URL when set', async () => {
  let url = '';
  let body: Record<string, unknown> = {};
  const fake = (async (u: string, init: RequestInit) => {
    url = u;
    body = JSON.parse(init.body as string);
    return new Response(JSON.stringify(chatOk('{}')), { status: 200 });
  }) as unknown as typeof fetch;
  await new OpenAIProvider({ apiKey: 'k', fetchImpl: fake, jsonMode: false, reasoningEffort: 'low', baseUrl: 'https://proxy.example.com/' }).call({ model: 'm', system: '', prompt: 'p', maxTokens: 10 });
  assert.equal(url, 'https://proxy.example.com/v1/chat/completions');
  assert.deepEqual(body['messages'], [{ role: 'user', content: 'p' }]);
  assert.ok(!('response_format' in body));
  assert.equal(body['reasoning_effort'], 'low');
});

test('OpenAIProvider surfaces HTTP errors, empty replies (token cap used up), refusals, and requires a key', async () => {
  await assert.rejects(new OpenAIProvider({ apiKey: 'k', fetchImpl: (async () => new Response('rate limited', { status: 429 })) as unknown as typeof fetch }).call({ model: 'm', system: '', prompt: 'p', maxTokens: 10 }), /openai http 429/);
  const cut = reply({ choices: [{ finish_reason: 'length', message: { content: '' } }], usage: { prompt_tokens: 50, completion_tokens: 300 } });
  await assert.rejects(new OpenAIProvider({ apiKey: 'k', fetchImpl: cut }).call({ model: 'm', system: '', prompt: 'p', maxTokens: 300 }), /no text.*finish_reason=length.*OPENAI_REASONING_EFFORT/);
  const refused = reply({ choices: [{ finish_reason: 'stop', message: { content: null, refusal: 'I cannot help with that.' } }] });
  await assert.rejects(new OpenAIProvider({ apiKey: 'k', fetchImpl: refused }).call({ model: 'm', system: '', prompt: 'p', maxTokens: 10 }), /openai refused/);
  const none = reply({ choices: [] });
  await assert.rejects(new OpenAIProvider({ apiKey: 'k', fetchImpl: none }).call({ model: 'm', system: '', prompt: 'p', maxTokens: 10 }), /no text/);
  assert.throws(() => new OpenAIProvider({ apiKey: '' }), /apiKey is required/);
});

test('missing usage never breaks a call, and the client works end to end through the OpenAI adapter (one retry on a malformed reply)', async () => {
  let n = 0;
  const fake = (async () => {
    n++;
    const text = n === 1 ? 'not json at all' : JSON.stringify({ modifier_id: 'low_fog', town_crier_line: 'Fog rolls in, mind your steps.', flavour_line: 'The lanterns look soft today.', mood_colour_id: 'grey' });
    return new Response(JSON.stringify(chatOk(text, n === 2 ? { prompt_tokens: 400, completion_tokens: 40, prompt_tokens_details: { cached_tokens: 300 } } : undefined)), { status: 200 });
  }) as unknown as typeof fetch;
  const client = new LlmClient({ provider: new OpenAIProvider({ apiKey: 'k', fetchImpl: fake }), model: 'm', pricing: { default: { inPerM: 2, outPerM: 8, cachedPerM: 0.5 }, models: {} } });
  const res = await client.complete('P6', { modifier_library: [{ id: 'low_fog', name: 'Low fog' }], last_seven_modifiers: [], date: '2026-01-01', seed_draw: { lens: 'mystery' } });
  assert.ok(res.ok, JSON.stringify(res));
  assert.equal(n, 2);
  assert.equal(res.records.length, 2);
  assert.equal(res.records[0]!.ok, false);
  const second = res.records[1]!;
  assert.deepEqual([second.tokensIn, second.tokensOut, second.tokensCached], [100, 40, 300]);
  assert.equal(second.costUsd, costUsd({ inputTokens: 100, outputTokens: 40, cachedTokens: 300 }, 'm', { default: { inPerM: 2, outPerM: 8, cachedPerM: 0.5 }, models: {} }));
});

/* ───────────── provider and price selection from the environment ───────────── */

test('providerFromEnv: anthropic by default, openai when asked, and clear errors (it never throws)', () => {
  const env = (o: Record<string, string>) => (k: string): string | undefined => o[k];
  const a = providerFromEnv(env({ ANTHROPIC_API_KEY: 'a', LLM_MODEL: 'm' }));
  assert.ok('provider' in a && a.provider instanceof AnthropicProvider && a.model === 'm');
  const o = providerFromEnv(env({ LLM_PROVIDER: ' OpenAI ', OPENAI_API_KEY: 'o', LLM_MODEL: 'm2', OPENAI_REASONING_EFFORT: 'low', OPENAI_JSON_MODE: '0' }));
  assert.ok('provider' in o && o.provider instanceof OpenAIProvider && o.provider.name === 'openai' && o.model === 'm2');
  assert.match((providerFromEnv(env({ LLM_PROVIDER: 'openai', LLM_MODEL: 'm' })) as { error: string }).error, /OPENAI_API_KEY is not set/);
  assert.match((providerFromEnv(env({ ANTHROPIC_API_KEY: 'a' })) as { error: string }).error, /LLM_MODEL is not set/);
  assert.match((providerFromEnv(env({ LLM_PROVIDER: 'gemini', LLM_MODEL: 'm' })) as { error: string }).error, /unknown LLM_PROVIDER/);
  // the other provider's key is never picked up by accident
  assert.match((providerFromEnv(env({ LLM_PROVIDER: 'openai', ANTHROPIC_API_KEY: 'a', LLM_MODEL: 'm' })) as { error: string }).error, /OPENAI_API_KEY/);
});

test('pricingFromEnv needs both prices, rejects junk, and never under-counts cached input', () => {
  const env = (o: Record<string, string>) => (k: string): string | undefined => o[k];
  assert.equal(pricingFromEnv(env({})), null);
  assert.equal(pricingFromEnv(env({ LLM_PRICE_IN_PER_M: '1' })), null);
  assert.equal(pricingFromEnv(env({ LLM_PRICE_IN_PER_M: 'abc', LLM_PRICE_OUT_PER_M: '5' })), null);
  assert.equal(pricingFromEnv(env({ LLM_PRICE_IN_PER_M: '-1', LLM_PRICE_OUT_PER_M: '5' })), null);
  assert.deepEqual(pricingFromEnv(env({ LLM_PRICE_IN_PER_M: '0.4', LLM_PRICE_OUT_PER_M: '1.6' }))!.default, { inPerM: 0.4, outPerM: 1.6, cachedPerM: 0.4 });
  assert.deepEqual(pricingFromEnv(env({ LLM_PRICE_IN_PER_M: '0.4', LLM_PRICE_OUT_PER_M: '1.6', LLM_PRICE_CACHED_PER_M: '0.1' }))!.default, { inPerM: 0.4, outPerM: 1.6, cachedPerM: 0.1 });
});

/* ───────────── bible coherence (T019): the story has to make sense, not just differ ───────────── */

test('every fallback bible makes sense: the twist has someone to land on, the villain\'s secret is the most specific fit, and no bystander holds a role for a crisis that is not happening', () => {
  for (let seed = 1; seed <= 400; seed++) {
    const b = buildFallbackBible(content, lore, { seed, recents: [] }).bible;
    const crisis = lore.crises[b.crisis.crisis_id]!;
    const where = `seed ${seed} (${crisis.id})`;
    // 1. the twist names roles that really are in the cast (and friendly, where the twist needs a friend)
    assert.ok(twistHolders(lore.twists[b.fingerprint.twist_id]!, b.cast_roles).length > 0, `${where}: twist ${b.fingerprint.twist_id} has no one to land on`);
    // 2. the villain's main secret is the most specific one that fits (fewest crises listed)
    const villain = b.cast_roles.find((c) => c.npc_id === b.fingerprint.antagonist_npc_id)!;
    const secret = lore.secrets[villain.secret_id!]!;
    const fits = Object.values(lore.secrets).filter((s) => s.crisisIds.includes(crisis.id) && s.holderRoles.includes(villain.role_id));
    assert.equal(secret.crisisIds.length, Math.min(...fits.map((s) => s.crisisIds.length)), `${where}: ${secret.id} is not the most specific secret for ${villain.role_id}`);
    // 3. only the villain holds a villain role of this crisis, and bystanders never hold a role that names another crisis
    for (const c of b.cast_roles) {
      const bound = lore.roleCrises[c.role_id];
      if (bound) assert.ok(bound.includes(crisis.id), `${where}: ${c.npc_id} is ${c.role_id} but this village has no ${bound.join('/')}`);
    }
  }
});

test('the validator rejects a bible whose twist has no one to land on, and the lint catches impossible twists and role bindings', () => {
  const b = newBible(5);
  const ok = validateRunBible(b, { content, lore, recents: [] });
  assert.deepEqual(ok.errors, []);
  const bad = clone(b);
  const need = lore.twists[bad.fingerprint.twist_id]!.requires.roles;
  for (const c of bad.cast_roles) {
    if (need.includes(c.role_id)) {
      const spare = content.npcs[c.npc_id]!.allowedRoles.find((r) => !need.includes(r) && !lore.crises[bad.crisis.crisis_id]!.antagonistRoles.includes(r));
      if (spare) c.role_id = spare;
    }
  }
  const v = validateRunBible(bad, { content, lore, recents: [] });
  assert.ok(v.errors.some((e) => /has no one to land on/.test(e)), v.errors.join('; '));

  const l = makeLore();
  l.twists['leader_was_right']!.requires = { roles: ['unicorn'] };
  l.twists['outsider_is_kin']!.requires = { roles: [] };
  l.roleCrises['nobody_role'] = ['no_such_crisis'];
  const errs = lintLore(l, content).join('\n');
  for (const needle of ['twist leader_was_right: no NPC can take required role unicorn', 'twist outsider_is_kin: needs at least one required role', 'roleCrises: no NPC can take role nobody_role', 'names unknown crisis no_such_crisis']) assert.ok(errs.includes(needle), needle);
});
