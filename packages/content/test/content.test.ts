import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadContent, lintContent, coverage, formatCoverage } from '../src/index.ts';
import { makeContent } from '../../engine/test/fixtures/content.ts';
import { createGame, advance } from '../../engine/src/index.ts';

const DATA = join(import.meta.dirname, '..', 'data');
const errors = (c: ReturnType<typeof makeContent>): string[] => lintContent(c).filter((i) => i.level === 'error').map((i) => `${i.where}: ${i.message}`);

test('the starter data files load and lint with zero errors', () => {
  const c = loadContent(DATA);
  assert.deepEqual(errors(c), []);
  assert.equal(Object.keys(c.npcs).length, 8);
});

test('data files stay in sync with the engine test fixtures (NPC flavour fields excepted)', () => {
  const data = loadContent(DATA);
  const fx = JSON.parse(JSON.stringify(makeContent()));
  assert.deepEqual({ ...data, npcs: null }, { ...fx, npcs: null });
  for (const [id, card] of Object.entries(fx.npcs) as [string, Record<string, unknown>][]) {
    const d = data.npcs[id] as unknown as Record<string, unknown>;
    for (const k of ['id', 'name', 'allowedRoles', 'home', 'work', 'gather']) assert.deepEqual(d[k], card[k], `${id}.${k}`);
  }
});

test('the 8-NPC starter cast matches the README and has full flavour', () => {
  const c = loadContent(DATA);
  assert.deepEqual(Object.keys(c.npcs).sort(), ['alder', 'bram', 'edda', 'maren', 'pip', 'tobin', 'voss', 'wren']);
  const roles = (id: string): string[] => [...c.npcs[id]!.allowedRoles].sort();
  assert.deepEqual(roles('tobin'), ['keeper', 'liar', 'victim']);
  assert.deepEqual(roles('edda'), ['cult_leader', 'griever', 'saint']);
  assert.deepEqual(roles('voss'), ['coward', 'hero', 'tyrant']);
  assert.deepEqual(roles('pip'), ['hope', 'thief', 'truth_seer']);
  assert.deepEqual(roles('wren'), ['guide', 'leaver', 'spy']);
  assert.deepEqual(roles('alder'), ['hoarder', 'traitor', 'weary_leader']);
  assert.deepEqual(roles('bram'), ['ally_trader', 'impostor', 'swindler']);
  assert.deepEqual(roles('maren'), ['friend', 'protector', 'rival', 'smuggler']);
  for (const n of Object.values(c.npcs)) {
    assert.ok(n.title && n.personality && n.speechStyle && n.tics!.length >= 3, n.id);
    assert.ok(!/[\u2013\u2014]/.test(`${n.personality}${n.speechStyle}${n.tics!.join('')}`), `${n.id}: no dashes in prose`);
  }
  // the six cast voices should be distinguishable: no two share a tic or a speech style
  const styles = new Set(Object.values(c.npcs).map((n) => n.speechStyle));
  assert.equal(styles.size, 8);
  assert.equal(new Set(Object.values(c.npcs).flatMap((n) => n.tics!)).size, 24);
});

test('the shipped data has no lint errors and no warnings', () => {
  assert.deepEqual(lintContent(loadContent(DATA)), []);
});

test('loaded content actually drives the engine', () => {
  const c = loadContent(DATA);
  const s = createGame(c, { seed: 3, startSeason: 'autumn' });
  s.village.hope = 9;
  advance(s, c, 1, 'idle');
  assert.ok(s.eventLog.some((e) => e.eventId === 'festival'));
});

test('the linter catches each class of mistake', () => {
  const c = makeContent();
  c.items['wood']!.id = 'timber';
  c.recipes['axe']!.inputs.push({ item: 'unobtainium', qty: 1 });
  c.nodes['oak_tree']!.tool = 'laser';
  c.enemies['wolf']!.drops.push({ item: 'wood', chance: 2, min: 1, max: 1 });
  c.npcs['maren']!.home = 'atlantis';
  c.events['festival']!.effects.push('village.gold +1');
  c.thresholds.push({ id: 'bad', conditions: [], event: 'ghost', cooldownDays: 1 });
  c.items['bread']!.food = undefined;
  const e = errors(c).join('\n');
  for (const needle of ['does not match its key', 'unknown item "unobtainium"', 'no item provides tool type "laser"', 'bad drop wood', 'home location "atlantis"', 'unknown_effect', 'unknown event "ghost"', 'no conditions', 'food item without food stats']) {
    assert.ok(e.includes(needle), `expected "${needle}" in:\n${e}`);
  }
});

test('an event nobody can fill, or with a one-candidate slot, is an error', () => {
  const c = makeContent();
  c.events['ghostly'] = { id: 'ghostly', tags: [], slots: { a: { roles: ['nonexistent_role'] } }, beats: [], effects: ['flag.set x'] };
  c.events['lonely'] = { id: 'lonely', tags: [], slots: { a: { roles: ['hope'] } }, beats: [], effects: ['flag.set y'] };
  const e = errors(c);
  assert.ok(e.some((m) => m.startsWith('event ghostly') && m.includes('can ever fill')));
  assert.ok(e.some((m) => m.startsWith('event lonely') && m.includes('only 1 possible')));
});

test('NPC cards are linted for roles, flavour and tics', () => {
  const c = makeContent();
  c.npcs['maren']!.allowedRoles = ['friend', 'friend'];
  c.npcs['tobin']!.personality = 'meh';
  c.npcs['edda']!.tics = ['one', 'one', 'two'];
  c.npcs['voss']!.title = '';
  const e = errors(c).join('\n');
  for (const needle of ['npc maren: needs at least 3 allowed roles', 'npc maren: duplicate allowed role', 'npc tobin: personality missing or too short', 'npc edda: duplicate tics', 'npc voss: missing title']) assert.ok(e.includes(needle), needle);
});

test('events must have effects; unreachable, requirement-free events are warned about', () => {
  const c = makeContent();
  c.events['empty'] = { id: 'empty', tags: [], slots: {}, beats: [], effects: [] };
  assert.ok(errors(c).some((m) => m.startsWith('event empty') && m.includes('no effects')));
  const w = lintContent(c).filter((i) => i.level === 'warning').map((i) => `${i.where}: ${i.message}`);
  assert.ok(w.some((m) => m.startsWith('event empty') && m.includes('no requirements')));
});

test('coverage counts card-level assignments and prints a report', () => {
  const cov = coverage(makeContent());
  const theft = cov.events.find((e) => e.id === 'midnight_theft')!;
  assert.deepEqual(theft.slots, [{ slot: 'thief', candidates: 3 }, { slot: 'victim', candidates: 3 }]);
  assert.equal(theft.assignments, 8); // 3 thieves x 3 victims, minus (alder, alder): one NPC cannot fill both slots
  assert.ok(cov.npcs['wren']!.events >= 1);
  assert.ok(cov.tags['crime']!.includes('midnight_theft'));
  assert.ok(cov.roles['thief']!.includes('midnight_theft'));
  const text = formatCoverage(cov);
  assert.match(text, /EVENT COVERAGE/);
  assert.match(text, /EVENTS PER TAG/);
  assert.match(text, /EVENTS PER ROLE/);
  assert.match(text, /midnight_theft/);
  assert.match(text, /Total card-level assignments/);
});

test('loader reports missing and malformed files clearly', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hm-content-'));
  cpSync(DATA, dir, { recursive: true });
  writeFileSync(join(dir, 'items.json'), '{oops');
  assert.throws(() => loadContent(dir), /items\.json is not valid JSON/);
  writeFileSync(join(dir, 'items.json'), '[]');
  assert.throws(() => loadContent(dir), /items\.json must be an object/);
  assert.throws(() => loadContent(join(dir, 'nope')), /missing items\.json/);
});
