/** Direct checks of the BUILD_PLAN section 9 requirements that the other test files do not already pin down. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LlmClient, MockProvider, REGISTRY, constitution, validate, PROMPT_FIXTURES, sampleVars, requestDialogue, prefetchDialogue, likelyAngle, revealableClues, buildFallbackBible, distance, runDirectedGame, fallbackDirector, listEligible, validateDirectorOutput, newDirectorMemory } from '../src/index.ts';
import type { DialogueContext, DirectorInput, RecentRun, OnboardingProfile } from '../src/index.ts';
import { Rng } from '../../engine/src/rng.ts';
import { hashState } from '../../engine/src/rng.ts';
import { ARCHETYPES } from '../src/schemas.ts';
import { content, lore, newState } from './fixtures.ts';

/* ───────────── provider adapter: complete(promptId, vars, opts) ───────────── */

test('complete() accepts per-call options: a shorter timeout and a lower token cap (never a higher one)', async () => {
  const slow = new MockProvider(() => new Promise<string>(() => {}));
  const client = new LlmClient({ provider: slow, model: 'm', timeoutMs: 60000 });
  const t0 = Date.now();
  const r = await client.complete('P6', sampleVars('P6'), { timeoutMs: 25 });
  assert.equal(r.ok, false);
  assert.ok(Date.now() - t0 < 2000);

  const p = new MockProvider(() => JSON.stringify(PROMPT_FIXTURES.P6));
  const c = new LlmClient({ provider: p, model: 'm' });
  await c.complete('P6', sampleVars('P6'), { maxTokens: 50 });
  await c.complete('P6', sampleVars('P6'), { maxTokens: 99999 });
  assert.equal(p.calls[0]!.maxTokens, 50);
  assert.equal(p.calls[1]!.maxTokens, REGISTRY.P6.maxTokens);
});

/* ───────────── prompt registry: versioned P0 to P9, each with schema and fixture ───────────── */

test('P0 is available, every other prompt has a version, a schema and a fixture in the package', () => {
  assert.match(constitution('My Game'), /My Game/);
  assert.ok(!constitution().includes('{{GAME_TITLE}}'));
  for (const id of Object.keys(REGISTRY) as (keyof typeof REGISTRY)[]) {
    assert.ok(REGISTRY[id].version);
    if (id === 'P2' || id === 'P3') continue; // their fixtures are produced by the real fallbacks
    assert.deepEqual(validate(REGISTRY[id].schema, PROMPT_FIXTURES[id as keyof typeof PROMPT_FIXTURES]), [], id);
  }
});

/* ───────────── pre-generation: dialogue ───────────── */

function dctx(over: Partial<DialogueContext> = {}): DialogueContext {
  const { state, bible } = newState(8);
  return { state, content, bible, npcId: bible.secrets[0]!.holder_npc_id, intent: 'greet', angle: 'ask', clueGateOpen: true, seed: 8, ...over };
}
const reply = (o: Record<string, unknown> = {}): string => JSON.stringify({ lines: ['Well met.'], mood: 'warm', memory_candidate: null, trust_delta: 1, reveals_clue_id: null, offers_action_id: null, ...o });

test('a pre-generated first reply is used with no new model call when the player does greet that NPC', async () => {
  const provider = new MockProvider(() => reply());
  const client = new LlmClient({ provider, model: 'm' });
  const c = dctx();
  const { prefetched, records } = await prefetchDialogue({ state: c.state, content, bible: c.bible, npcId: c.npcId, clueGateOpen: true, seed: 8 }, client);
  assert.ok(prefetched && records.length === 1);
  assert.equal(provider.calls.length, 1);
  assert.equal(prefetched!.intent, 'greet');
  assert.equal(prefetched!.angle, likelyAngle(c.state, c.npcId));
  const r = await requestDialogue({ ...c, angle: prefetched!.angle }, client, prefetched);
  assert.equal(provider.calls.length, 1, 'no second call');
  assert.equal(r.usedPrefetch, true);
  assert.equal(r.source, 'llm');
  assert.equal(r.trustApplied, 1);
});

test('a pre-generated reply is discarded when the player picks something else, types text, or the gate changed', async () => {
  const mk = async (): Promise<{ provider: MockProvider; client: LlmClient; c: DialogueContext; pre: Awaited<ReturnType<typeof prefetchDialogue>>['prefetched'] }> => {
    const provider = new MockProvider(() => reply({ reveals_clue_id: null }));
    const client = new LlmClient({ provider, model: 'm' });
    const c = dctx();
    const { prefetched } = await prefetchDialogue({ state: c.state, content, bible: c.bible, npcId: c.npcId, clueGateOpen: true, seed: 8 }, client);
    return { provider, client, c, pre: prefetched };
  };
  for (const change of [{ intent: 'threaten' as const }, { angle: 'warn' as const }, { typedText: 'hello there' }, { npcId: 'pip' }]) {
    const { provider, client, c, pre } = await mk();
    const r = await requestDialogue({ ...c, angle: 'ask', ...change }, client, pre);
    assert.equal(r.usedPrefetch, false, JSON.stringify(change));
    assert.equal(provider.calls.length, 2);
  }
  // a prefetched reply that reveals a clue is dropped if the gate has since closed
  const clue = revealableClues(dctx().bible, dctx().npcId)[0]!;
  const provider = new MockProvider(() => reply({ reveals_clue_id: clue }));
  const client = new LlmClient({ provider, model: 'm' });
  const c = dctx();
  const { prefetched } = await prefetchDialogue({ state: c.state, content, bible: c.bible, npcId: c.npcId, clueGateOpen: true, seed: 8 }, client);
  assert.ok(prefetched);
  const before = hashState(c.state);
  const r = await requestDialogue({ ...c, angle: prefetched!.angle, clueGateOpen: false }, null, prefetched);
  assert.equal(r.usedPrefetch, false);
  assert.equal(r.clueRevealed, null);
  assert.deepEqual(c.state.plantedClues, []);
  assert.equal(hashState(c.state), before);
});

test('prefetch never throws and never changes the game: failures and bad replies just return nothing', async () => {
  const c = dctx();
  const before = hashState(c.state);
  const base = { state: c.state, content, bible: c.bible, npcId: c.npcId, clueGateOpen: true, seed: 8 };
  assert.deepEqual((await prefetchDialogue(base, null)).prefetched, null);
  const dead = new LlmClient({ provider: new MockProvider(() => { throw new Error('down'); }), model: 'm' });
  assert.equal((await prefetchDialogue(base, dead)).prefetched, null);
  const hostile = new LlmClient({ provider: new MockProvider(() => reply({ trust_delta: 1, offers_action_id: 'give_everything' })), model: 'm' });
  assert.equal((await prefetchDialogue(base, hostile)).prefetched, null);
  assert.equal(hashState(c.state), before);
});

/* ───────────── fallback Run Bible: never within distance 2 of a recent fingerprint ───────────── */

test('the fallback builder keeps distance >= 3 from each of the last 10 runs, whoever played them (600 runs)', () => {
  const rng = new Rng(11);
  const recents: RecentRun[] = [];
  for (let i = 0; i < 600; i++) {
    const scores = Object.fromEntries(ARCHETYPES.map((a) => [a, Math.round(rng.next() * 100) / 100])) as OnboardingProfile['archetype_scores'];
    const profile: OnboardingProfile = { values: ['x'], fears: ['y'], archetype_scores: scores, core_motivation: rng.pick(['safety', 'power', 'freedom', 'home'] as const), backstory_seed: 'b', contradiction: null, story_hook: 'h', spawn_preference: { spawn_id: 'gate_arrival', reason: 'r' }, starting_kit_id: 'trader' };
    const r = buildFallbackBible(content, lore, { seed: i + 1, recents, profile });
    assert.equal(r.relaxed, false, `run ${i} had to relax`);
    for (const prev of recents.slice(-10)) assert.ok(distance(r.bible.fingerprint, prev.fingerprint) >= 3, `run ${i} is within distance 2 of a recent run`);
    recents.push({ fingerprint: r.bible.fingerprint, profileKey: r.profileKey });
  }
});

/* ───────────── fallback Director: arc acts and validity ───────────── */

test('the fallback Director follows the arc: confrontation beats are favoured late, setup beats early', async () => {
  // measured conditionally: only decisions where both kinds of beat were actually available
  const rate = { early: { n: 0, conf: 0, setup: 0, nSetup: 0 }, late: { n: 0, conf: 0, setup: 0, nSetup: 0 } };
  for (let seed = 1; seed <= 150; seed++) {
    const seen: { day: number; clock: number; tags: string[][] }[] = [];
    const r = await runDirectedGame(content, lore, { seed, days: 12, beforeDecide: (i) => void seen.push({ day: i.decision.day, clock: i.bible.crisis.clock_days, tags: listEligible(i.state, content).map((e) => e.tags) }) });
    r.decisions.forEach((d, k) => {
      const inp = seen[k];
      if (!inp || !d.eventId) return;
      const progress = inp.day / inp.clock;
      const bucket = progress < 1 / 3 ? rate.early : progress >= 2 / 3 ? rate.late : null;
      if (!bucket) return;
      const tags = content.events[d.eventId]!.tags;
      if (inp.tags.some((t) => t.includes('confrontation')) && inp.tags.some((t) => !t.includes('confrontation'))) {
        bucket.n++;
        if (tags.includes('confrontation')) bucket.conf++;
      }
      if (inp.tags.some((t) => t.includes('setup')) && inp.tags.some((t) => !t.includes('setup'))) {
        bucket.nSetup++;
        if (tags.includes('setup')) bucket.setup++;
      }
    });
  }
  assert.ok(rate.early.n > 100 && rate.late.n > 100 && rate.early.nSetup > 100 && rate.late.nSetup > 100, JSON.stringify(rate));
  assert.ok(rate.late.conf / rate.late.n > rate.early.conf / rate.early.n + 0.15, JSON.stringify(rate));
  assert.ok(rate.early.setup / rate.early.nSetup > rate.late.setup / rate.late.nSetup + 0.05, JSON.stringify(rate));
});

test('whatever the state, the fallback Director output always passes its own validator (property test)', async () => {
  let checked = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const inputs: DirectorInput[] = [];
    await runDirectedGame(content, lore, { seed, days: 10, beforeDecide: (i) => void inputs.push({ ...i, memory: JSON.parse(JSON.stringify(i.memory)), state: JSON.parse(JSON.stringify(i.state)) }) });
    for (const input of inputs) {
      const out = fallbackDirector(input);
      if (!out) continue;
      const eligible = listEligible(input.state, content);
      const v = validateDirectorOutput(out, { state: input.state, content, lore, eligible, memory: input.memory });
      assert.deepEqual(v.errors, [], `seed ${seed} day ${input.decision.day}`);
      checked++;
    }
  }
  assert.ok(checked > 400, `only ${checked} decisions checked`);
  void newDirectorMemory;
});
