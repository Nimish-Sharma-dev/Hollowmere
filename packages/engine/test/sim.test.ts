import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runHeadless, survivalBot, createGame, perform, advance, serialize, deserialize, cloneState, hashState, checkInvariants, dayOf } from '../src/index.ts';
import type { SimOptions } from '../src/index.ts';
import { makeContent, SIM_NODES, SIM_START } from './fixtures/content.ts';

const base = (over: Partial<SimOptions> = {}): SimOptions => ({
  seed: 1, days: 30, startSeason: 'autumn', nodes: SIM_NODES, startItems: SIM_START, equipped: { clothing: 'wool_coat' }, ...over,
});

test('a 30-day headless sim completes with no invariant violations', () => {
  const r = runHeadless(makeContent(), base());
  assert.deepEqual(r.violations, []);
  assert.ok(r.state.tick >= 30 * 240);
  assert.ok(r.dayHashes.length >= 29);
});

test('the same seed reproduces the exact same game, every day', () => {
  const a = runHeadless(makeContent(), base({ seed: 7 }));
  const b = runHeadless(makeContent(), base({ seed: 7 }));
  assert.equal(a.finalHash, b.finalHash);
  assert.deepEqual(a.dayHashes, b.dayHashes);
  assert.equal(serialize(a.state), serialize(b.state));
});

test('different seeds produce different games', () => {
  const hashes = new Set([1, 2, 3, 4, 5].map((seed) => runHeadless(makeContent(), base({ seed })).finalHash));
  assert.equal(hashes.size, 5);
});

test('the reference survival bot lives through 30 days across seasons (regression guard)', () => {
  for (const startSeason of ['spring', 'autumn', 'winter'] as const) {
    for (const seed of [1, 2, 3]) {
      const r = runHeadless(makeContent(), base({ seed, startSeason }));
      assert.equal(r.state.player.alive, true, `seed ${seed} ${startSeason}: died on day ${r.deathDay} (${r.state.player.deathCause})`);
    }
  }
});

test('robustness sweep: 40 seeds, all seasons, no violations, no crashes', () => {
  const seasons = ['spring', 'summer', 'autumn', 'winter'] as const;
  for (let seed = 100; seed < 140; seed++) {
    const r = runHeadless(makeContent(), base({ seed, days: 20, startSeason: seasons[seed % 4]! }));
    assert.deepEqual(r.violations, [], `seed ${seed}`);
  }
});

test('the world keeps running after the player dies', () => {
  const r = runHeadless(makeContent(), base({ days: 20, startItems: [], equipped: {}, startSeason: 'winter', nodes: [] }));
  assert.equal(r.state.player.alive, false);
  assert.ok(r.deathDay !== null && r.deathDay < 20);
  assert.ok(r.state.tick >= 20 * 240);
  assert.deepEqual(r.violations, []);
});

test('a run can be saved mid-way, loaded, and continues identically', () => {
  const content = makeContent();
  const play = (s: ReturnType<typeof createGame>, untilDay: number): void => {
    while (dayOf(s.tick) < untilDay) {
      const a = survivalBot(s, content);
      const res = a ? perform(s, content, a) : ({ ok: false } as const);
      if (!res.ok) advance(s, content, 1, 'idle');
    }
  };
  const s1 = createGame(content, base());
  play(s1, 10);
  const saved = serialize(s1);
  const s2 = deserialize(saved);
  assert.equal(serialize(s2), saved);
  play(s1, 20);
  play(s2, 20);
  assert.equal(hashState(s1), hashState(s2));
  assert.equal(serialize(s1), serialize(s2));
});

test('deserialize rejects bad saves with clear errors', () => {
  const s = createGame(makeContent(), base());
  assert.throws(() => deserialize('{not json'), /not valid JSON/);
  assert.throws(() => deserialize('42'), /not an object/);
  assert.throws(() => deserialize(JSON.stringify({ ...s, version: 2 })), /unsupported version/);
  const { player: _p, ...noPlayer } = s;
  assert.throws(() => deserialize(JSON.stringify(noPlayer)), /missing field "player"/);
  assert.throws(() => deserialize(JSON.stringify({ ...s, tick: -3 })), /bad tick/);
});

test('cloneState is a deep, independent copy', () => {
  const s = createGame(makeContent(), base());
  const c = cloneState(s);
  c.village.hope = 9;
  c.player.inventory.stacks.push({ item: 'wood', qty: 1 });
  assert.equal(s.village.hope, 5);
  assert.equal(hashState(s), hashState(cloneState(s)));
  assert.notEqual(hashState(s), hashState(c));
});

test('checkInvariants catches corrupted state', () => {
  const content = makeContent();
  const s = createGame(content, base());
  assert.deepEqual(checkInvariants(s, content), []);
  s.player.stats.hunger = 150;
  s.village.hope = -1;
  s.player.inventory.stacks.push({ item: 'wood', qty: 99 });
  s.nodes['oak_01']!.usesLeft = -1;
  const problems = checkInvariants(s, content).join(' | ');
  for (const needle of ['stat hunger', 'village hope', 'stack wood', 'oak_01']) assert.ok(problems.includes(needle), needle);
});

test('createGame validates its inputs', () => {
  const c = makeContent();
  assert.throws(() => createGame(c, { seed: 1, startItems: [{ item: 'nope', qty: 1 }] }), /unknown start item/);
  assert.throws(() => createGame(c, { seed: 1, nodes: [{ id: 'x', def: 'nope' }] }), /unknown node def/);
  assert.throws(() => createGame(c, { seed: 1, nodes: [{ id: 'x', def: 'oak_tree' }, { id: 'x', def: 'oak_tree' }] }), /duplicate node id/);
});
