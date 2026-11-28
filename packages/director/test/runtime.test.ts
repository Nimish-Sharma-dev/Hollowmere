import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runDirectedGame, validateRunBible, divergenceGate, summarize, LlmClient, MockProvider, fallbackDirector, startGameFromBible } from '../src/index.ts';
import type { DirectorInput, RecentRun, OnboardingProfile, RunBible } from '../src/index.ts';
import { Rng } from '../../engine/src/rng.ts';
import { ARCHETYPES } from '../src/schemas.ts';
import { content, lore, newBible } from './fixtures.ts';

function profile(rng: Rng): OnboardingProfile {
  const scores = Object.fromEntries(ARCHETYPES.map((a) => [a, Math.round(rng.next() * 100) / 100])) as OnboardingProfile['archetype_scores'];
  return { values: ['loyalty'], fears: ['cold'], archetype_scores: scores, core_motivation: rng.pick(['safety', 'power', 'freedom', 'home'] as const), backstory_seed: 'x', contradiction: null, story_hook: 'y', spawn_preference: { spawn_id: rng.pick(Object.keys(lore.spawns).sort()), reason: 'r' }, starting_kit_id: rng.pick(Object.keys(lore.kits).sort()) };
}

test('T019: 1,000 headless games complete with no LLM, valid bibles, no invariant violations, and the divergence gate passes', async () => {
  const rng = new Rng(77);
  const recents: RecentRun[] = [];
  const bibles: RunBible[] = [];
  const hashes = new Set<string>();
  let relaxed = 0;
  let decisions = 0;
  let eventsRun = 0;
  const stance = { mirror: 0, challenge: 0, wildcard: 0 };
  for (let i = 0; i < 1000; i++) {
    const p = profile(rng);
    const r = await runDirectedGame(content, lore, { seed: i + 1, days: 3, profile: p, recents });
    assert.deepEqual(r.violations, [], `run ${i}`);
    assert.ok(r.state.tick >= 3 * 240);
    const v = validateRunBible(r.bible, { content, lore, recents, profileKey: r.profileKey });
    assert.deepEqual(v.errors, [], `run ${i} bible`);
    if (v.fingerprint && !v.fingerprint.ok) relaxed++;
    assert.ok(r.decisions.every((d) => d.source === 'fallback' || d.source === 'none'), 'no LLM involved');
    decisions += r.decisions.length;
    eventsRun += r.state.eventLog.length;
    for (const k of ['mirror', 'challenge', 'wildcard'] as const) stance[k] += r.memory.stanceCounts[k];
    recents.push({ fingerprint: r.bible.fingerprint, profileKey: r.profileKey });
    bibles.push(r.bible);
    hashes.add(r.finalHash);
  }
  assert.equal(relaxed, 0);
  assert.ok(hashes.size >= 990, `runs should differ, got ${hashes.size} distinct outcomes`);
  assert.ok(decisions > 5000 && eventsRun > 3000, `decisions ${decisions}, events ${eventsRun}`);
  const total = stance.mirror + stance.challenge + stance.wildcard;
  assert.ok(stance.mirror / total > 0.2 && stance.challenge / total > 0.2 && stance.wildcard / total > 0.05, JSON.stringify(stance));
  const gate = divergenceGate(bibles, 2000, new Rng(3));
  assert.ok(gate.pass, JSON.stringify(gate));
});

test('a long directed game keeps the stance mix near 40/40/20 and never breaks an invariant', async () => {
  const r = await runDirectedGame(content, lore, { seed: 31, days: 40 });
  assert.deepEqual(r.violations, []);
  const c = r.memory.stanceCounts;
  const total = c.mirror + c.challenge + c.wildcard;
  assert.ok(total >= 40);
  for (const k of ['mirror', 'challenge'] as const) assert.ok(c[k] / total <= 0.65, `${k} share ${c[k] / total}`);
});

/* ───────────── T020: a full run with mocked Director output ───────────── */

function mockDirectorClient(script: (input: DirectorInput, call: number) => string): { client: LlmClient; provider: MockProvider; beforeDecide: (i: DirectorInput) => void } {
  let current: DirectorInput | null = null;
  const provider = new MockProvider((_r, i) => script(current!, i));
  return { client: new LlmClient({ provider, model: 'mock' }), provider, beforeDecide: (i) => void (current = i) };
}

test('T020: a full run where a mocked model directs every beat', async () => {
  const m = mockDirectorClient((input) => JSON.stringify(fallbackDirector(input)));
  const r = await runDirectedGame(content, lore, { seed: 4, days: 10, client: m.client, beforeDecide: m.beforeDecide, bible: newBible(4) });
  assert.deepEqual(r.violations, []);
  const sources = r.decisions.map((d) => d.source);
  assert.ok(sources.includes('llm'));
  assert.ok(!sources.includes('fallback'), `unexpected fallback: ${JSON.stringify(r.decisions.filter((d) => d.source === 'fallback').slice(0, 2))}`);
  assert.ok(r.state.eventLog.length >= 10);
  const cost = summarize(r.records);
  assert.ok(cost.calls >= 10 && cost.costUsd > 0);
  assert.equal(cost.failed, 0);
});

test('T020: pre-generation writes tomorrow morning in the evening, and the morning uses it', async () => {
  const m = mockDirectorClient((input) => JSON.stringify(fallbackDirector(input)));
  const r = await runDirectedGame(content, lore, { seed: 4, days: 10, client: m.client, beforeDecide: m.beforeDecide, bible: newBible(4) });
  assert.ok(r.pregenUsed >= 3, `pregenUsed ${r.pregenUsed}`);
  assert.ok(r.decisions.some((d) => d.source === 'pregenerated'));
  // pre-generated beats cost calls in the evening; morning decisions that used them cost none
  const morningLlm = r.decisions.filter((d) => d.kind === 'day_start' && d.source === 'llm').length;
  assert.ok(r.pregenUsed > morningLlm);
});

test('T020: hostile or broken model output falls back, the game still completes, and no bad event ever runs', async () => {
  const valid = new Set(Object.keys(content.events));
  const bad = [
    (i: DirectorInput) => JSON.stringify({ ...fallbackDirector(i), chosen_event_id: 'summon_dragon' }),
    () => 'I cannot decide. Maybe both?',
    (i: DirectorInput) => JSON.stringify({ ...fallbackDirector(i), slot_assignments: { thief: 'nobody', victim: 'nobody' } }),
    (i: DirectorInput) => JSON.stringify({ ...fallbackDirector(i), rumor_seed: 'burn it all', dilemma_template_id: 'doom' }),
  ];
  for (const [n, script] of bad.entries()) {
    const m = mockDirectorClient((input) => script(input));
    const r = await runDirectedGame(content, lore, { seed: 6, days: 8, client: m.client, beforeDecide: m.beforeDecide, bible: newBible(6) });
    assert.deepEqual(r.violations, [], `script ${n}`);
    assert.ok(r.decisions.filter((d) => d.eventId).every((d) => d.source === 'fallback'), `script ${n} let a bad output through`);
    assert.ok(r.state.eventLog.every((e) => valid.has(e.eventId)));
    assert.ok(r.decisions.some((d) => d.reason), 'rejections carry a reason');
  }
});

test('T020: a model that times out or errors on every call still yields a playable game', async () => {
  const dead = new LlmClient({ provider: new MockProvider(() => { throw new Error('network down'); }), model: 'm' });
  const r = await runDirectedGame(content, lore, { seed: 9, days: 6, client: dead, bible: newBible(9) });
  assert.deepEqual(r.violations, []);
  assert.ok(r.state.eventLog.length >= 4);
  assert.ok(r.decisions.filter((d) => d.eventId).every((d) => d.source === 'fallback'));
});

test('bibles turn into valid engine states (roles, kit, village stats, attitudes)', () => {
  const b = newBible(15);
  const s = startGameFromBible(content, lore, b, 15);
  for (const c of b.cast_roles) {
    assert.equal(s.npcs[c.npc_id]!.role, c.role_id);
    assert.equal(s.npcs[c.npc_id]!.trust, c.initial_attitude);
  }
  assert.deepEqual(s.village, b.start.village_stats);
  assert.ok(s.player.inventory.stacks.length >= 3);
});
