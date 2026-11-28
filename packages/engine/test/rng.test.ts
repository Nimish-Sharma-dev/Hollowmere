import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Rng, hashString, hashSeed, subRng, stableStringify } from '../src/index.ts';

test('same seed gives the same sequence; different seeds differ', () => {
  const a = new Rng(123);
  const b = new Rng(123);
  const c = new Rng(124);
  const sa = Array.from({ length: 1000 }, () => a.next());
  const sb = Array.from({ length: 1000 }, () => b.next());
  const sc = Array.from({ length: 1000 }, () => c.next());
  assert.deepEqual(sa, sb);
  assert.notDeepEqual(sa, sc);
  assert.ok(sa.every((x) => x >= 0 && x < 1));
});

test('state can be saved and resumed mid-stream', () => {
  const a = new Rng(7);
  for (let i = 0; i < 50; i++) a.next();
  const resumed = new Rng(a.s);
  for (let i = 0; i < 50; i++) assert.equal(a.next(), resumed.next());
});

test('int is inclusive on both ends and never leaves the range', () => {
  const r = new Rng(1);
  const seen = new Set<number>();
  for (let i = 0; i < 2000; i++) {
    const v = r.int(3, 6);
    assert.ok(v >= 3 && v <= 6 && Number.isInteger(v));
    seen.add(v);
  }
  assert.deepEqual([...seen].sort(), [3, 4, 5, 6]);
  assert.equal(r.int(5, 5), 5);
  assert.throws(() => r.int(5, 4));
});

test('shuffle is a deterministic permutation and does not mutate its input', () => {
  const input = [1, 2, 3, 4, 5, 6, 7, 8];
  const a = new Rng(9).shuffle(input);
  const b = new Rng(9).shuffle(input);
  assert.deepEqual(a, b);
  assert.deepEqual([...a].sort((x, y) => x - y), input);
  assert.deepEqual(input, [1, 2, 3, 4, 5, 6, 7, 8]);
});

test('weighted never picks zero-weight items and follows the weights roughly', () => {
  const r = new Rng(5);
  const counts = { a: 0, b: 0, never: 0 };
  for (let i = 0; i < 4000; i++) counts[r.weighted([{ item: 'a' as const, weight: 3 }, { item: 'b' as const, weight: 1 }, { item: 'never' as const, weight: 0 }])]++;
  assert.equal(counts.never, 0);
  assert.ok(counts.a > counts.b * 2.4 && counts.a < counts.b * 3.8, `ratio ${counts.a / counts.b}`);
  assert.throws(() => r.weighted([{ item: 1, weight: 0 }]));
});

test('pick throws on an empty array; chance respects 0 and 1', () => {
  const r = new Rng(2);
  assert.throws(() => r.pick([]));
  for (let i = 0; i < 50; i++) {
    assert.equal(r.chance(0), false);
    assert.equal(r.chance(1), true);
  }
});

test('hashing helpers are stable', () => {
  assert.equal(hashString('a'), 0xe40c292c); // FNV-1a 32-bit reference vector
  assert.equal(hashSeed(1, 'x'), hashString('1|x'));
  assert.equal(subRng(5, 'w', 2).next(), subRng(5, 'w', 2).next());
  assert.notEqual(subRng(5, 'w', 2).next(), subRng(5, 'w', 3).next());
  assert.equal(stableStringify({ b: 1, a: [2, { d: 1, c: 2 }] }), '{"a":[2,{"c":2,"d":1}],"b":1}');
});
