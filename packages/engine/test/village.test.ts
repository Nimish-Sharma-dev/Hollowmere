import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advance, adjustVillage, adjustTrust, npcLocation, checkThresholds, runEvent, currentDay } from '../src/index.ts';
import { newGame, dayStart } from './helpers.ts';

/* ───────────── NPC schedules ───────────── */

test('NPCs follow home / work / gathering spot by phase', () => {
  const { state, content } = newGame();
  const at = (tick: number, id: string): string | null => {
    state.tick = tick;
    return npcLocation(state, content, id);
  };
  assert.equal(at(0, 'maren'), 'forge'); // morning: work
  assert.equal(at(100, 'maren'), 'forge'); // day: work
  assert.equal(at(150, 'maren'), 'meeting_hall'); // evening: gather
  assert.equal(at(200, 'maren'), 'home_maren'); // night: home
  assert.equal(at(100, 'edda'), 'chapel');
  assert.equal(at(100, 'voss'), 'watchtower');
  assert.equal(at(200, 'bram'), 'village_gate');
});

test('a card can define its own schedule, and the dead are nowhere', () => {
  const { state, content } = newGame();
  content.npcs['wren']!.schedule = { night: 'work', morning: 'gather' };
  state.tick = 200;
  assert.equal(npcLocation(state, content, 'wren'), 'forest_edge'); // work at night
  state.npcs['wren']!.alive = false;
  assert.equal(npcLocation(state, content, 'wren'), null);
  assert.equal(npcLocation(state, content, 'ghost'), null);
});

test('event overrides beat the schedule and expire at the end of the day', () => {
  const { state, content } = newGame({ npcRoles: { maren: 'friend' } });
  state.tick = 100;
  const r = runEvent(state, content, 'soup_kitchen', { assignment: { cook: 'maren' } });
  assert.ok(r.ok);
  assert.equal(npcLocation(state, content, 'maren'), 'meeting_hall');
  state.tick = 150; // evening would be meeting_hall anyway, so check a different phase first
  state.tick = 60;
  assert.equal(npcLocation(state, content, 'maren'), 'meeting_hall'); // day: would be forge
  state.tick = dayStart(2);
  assert.equal(npcLocation(state, content, 'maren'), 'forge'); // next morning: back to work
});

/* ───────────── village stats ───────────── */

test('village stats and NPC trust clamp to their ranges', () => {
  const { state } = newGame();
  adjustVillage(state, 'hope', 100);
  adjustVillage(state, 'fear', -100);
  assert.equal(state.village.hope, 10);
  assert.equal(state.village.fear, 0);
  adjustTrust(state, 'maren', 50);
  assert.equal(state.npcs['maren']!.trust, 10);
  adjustTrust(state, 'maren', -50);
  assert.equal(state.npcs['maren']!.trust, -10);
  adjustTrust(state, 'nobody', 1); // ignored, no throw
});

test('seasonal drift is applied once per day rollover', () => {
  const { state, content } = newGame({ startSeason: 'winter' });
  advance(state, content, 239, 'idle');
  assert.equal(state.village.hunger, 3); // nothing before the rollover
  advance(state, content, 1, 'idle');
  assert.equal(currentDay(state), 2);
  assert.equal(state.village.hunger, 3.5);
  assert.equal(state.village.hope, 4.9);
  assert.equal(state.village.fear, 3.1);
});

/* ───────────── thresholds ───────────── */

test('every threshold fires its event when its condition becomes true', () => {
  const setups: Record<string, () => Record<string, number>> = {
    hope_high: () => ({ hope: 8 }),
    fear_high: () => ({ fear: 8 }),
    hunger_high: () => ({ hunger: 7 }),
    trust_high: () => ({ trust: 8 }),
    unity_low: () => ({ unity: 2 }),
    everything_low: () => ({ hope: 2, trust: 2, unity: 2 }),
  };
  for (const [id, make] of Object.entries(setups)) {
    const { state, content } = newGame();
    const t = content.thresholds.find((x) => x.id === id)!;
    for (const [stat, v] of Object.entries(make())) state.village[stat as 'hope'] = v;
    advance(state, content, 1, 'idle');
    assert.ok(state.eventLog.some((e) => e.eventId === t.event), `${id} should have run ${t.event}`);
    assert.equal(state.thresholds[id]!.fired, 1);
  }
});

test('thresholds are edge-triggered: staying above the line does not refire', () => {
  const { state, content } = newGame();
  state.village.hope = 8;
  advance(state, content, 60, 'idle');
  assert.equal(state.eventLog.filter((e) => e.eventId === 'festival').length, 1);
  assert.equal(state.thresholds['hope_high']!.active, true);
});

test('thresholds respect their cooldown, and once-only thresholds fire once', () => {
  const { state, content } = newGame();
  state.village.hope = 8.5;
  advance(state, content, 1, 'idle'); // fires (festival: hope +1 => 9.5)
  state.village.hope = 3;
  advance(state, content, 1, 'idle'); // drops below, re-arms
  state.village.hope = 9;
  advance(state, content, 1, 'idle'); // crosses again on day 1: cooldown (5 days) blocks it
  assert.equal(state.thresholds['hope_high']!.fired, 1);
  state.village.hope = 3;
  advance(state, content, dayStart(7) - state.tick, 'idle'); // well past the cooldown
  state.village.hope = 9;
  advance(state, content, 1, 'idle');
  assert.equal(state.thresholds['hope_high']!.fired, 2);

  const o = newGame();
  for (const k of ['hope', 'trust', 'unity'] as const) o.state.village[k] = 1;
  advance(o.state, o.content, 1, 'idle');
  assert.equal(o.state.thresholds['everything_low']!.fired, 1);
  for (const k of ['hope', 'trust', 'unity'] as const) o.state.village[k] = 6;
  advance(o.state, o.content, 1, 'idle');
  for (const k of ['hope', 'trust', 'unity'] as const) o.state.village[k] = 1;
  advance(o.state, o.content, 1, 'idle');
  assert.equal(o.state.thresholds['everything_low']!.fired, 1);
});

test('checkThresholds reports which thresholds fired', () => {
  const { state, content } = newGame();
  state.village.fear = 9;
  assert.deepEqual(checkThresholds(state, content), ['fear_high']);
  assert.deepEqual(checkThresholds(state, content), []);
});

test('chained events: famine schedules a soup kitchen the next day', () => {
  const { state, content } = newGame();
  state.village.hunger = 7.5;
  advance(state, content, 1, 'idle');
  assert.ok(state.eventLog.some((e) => e.eventId === 'famine'));
  assert.equal(state.flags['famine_seen'], true);
  assert.ok(!state.eventLog.some((e) => e.eventId === 'soup_kitchen'));
  advance(state, content, dayStart(2) - state.tick, 'idle');
  const soup = state.eventLog.find((e) => e.eventId === 'soup_kitchen');
  assert.ok(soup, 'soup kitchen should run on day 2');
  assert.equal(soup!.day, 2);
});

test('a hungry autumn into winter triggers a famine on its own, with no player input', () => {
  const { state, content } = newGame({ startSeason: 'autumn' });
  advance(state, content, 40 * 240, 'idle');
  const famine = state.eventLog.find((e) => e.eventId === 'famine');
  assert.ok(famine, 'famine should fire during the first winter');
  assert.ok(famine!.day >= 9 && famine!.day <= 25, `famine on day ${famine!.day}`);
  for (const stat of Object.values(state.village)) assert.ok(stat >= 0 && stat <= 10);
});
