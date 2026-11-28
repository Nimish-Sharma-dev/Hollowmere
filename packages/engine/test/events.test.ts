import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseEffect, validateEvent, checkRequirements, eligibleNpcs, assignSlots, enumerateAssignments, validateAssignment,
  runEvent, runDueEvents, scheduleEvent, advance, cloneState, Rng, count, renderBeats,
} from '../src/index.ts';
import type { EventDef } from '../../shared/src/index.ts';
import { newGame, dayStart } from './helpers.ts';

const ROLES = { pip: 'thief', bram: 'swindler', alder: 'hoarder', tobin: 'victim', maren: 'friend', edda: 'saint', voss: 'hero', wren: 'guide' };

/* ───────────── effect vocabulary ───────────── */

test('parseEffect accepts exactly the fixed vocabulary', () => {
  const ok = (t: string) => {
    const r = parseEffect(t);
    assert.ok(r.ok, t);
    return r.ok ? r.effect : (null as never);
  };
  assert.deepEqual(ok('village.hope +2'), { kind: 'village', stat: 'hope', delta: 2 });
  assert.deepEqual(ok('village.fear -1.5'), { kind: 'village', stat: 'fear', delta: -1.5 });
  assert.deepEqual(ok('npc[thief].trust -2'), { kind: 'trust', slot: 'thief', delta: -2 });
  assert.deepEqual(ok('flag.set met_pip'), { kind: 'flag', id: 'met_pip' });
  assert.deepEqual(ok('spawn npc[cook] at meeting_hall'), { kind: 'spawn', slot: 'cook', location: 'meeting_hall' });
  assert.deepEqual(ok('give item bread'), { kind: 'give', item: 'bread', qty: 1 });
  assert.deepEqual(ok('give item bread 3'), { kind: 'give', item: 'bread', qty: 3 });
  assert.deepEqual(ok('start dilemma confront_hoarder'), { kind: 'dilemma', id: 'confront_hoarder' });
  assert.deepEqual(ok('plant clue stolen_coin'), { kind: 'clue', id: 'stolen_coin' });
  assert.deepEqual(ok('schedule event famine in 2'), { kind: 'schedule', event: 'famine', days: 2 });
});

test('parseEffect rejects anything else', () => {
  for (const bad of [
    'village.gold +1', 'village.hope 1', 'village.hope +', 'flag.set Foo', 'flag.set', 'npc[x].trust', 'npc[X].trust +1',
    'give item', 'give item bread -1', 'spawn npc[x]', 'schedule event famine in', 'schedule event famine in -1',
    'kill npc[x]', ' village.hope +1', 'village.hope +1 ', 'village.hope +1; flag.set x', '',
  ]) {
    assert.equal(parseEffect(bad).ok, false, `"${bad}" should be rejected`);
  }
});

/* ───────────── validation ───────────── */

test('all fixture events are valid against the fixture content', () => {
  const { content } = newGame();
  for (const ev of Object.values(content.events)) assert.deepEqual(validateEvent(ev, content), [], ev.id);
  for (const t of content.thresholds) assert.ok(content.events[t.event], `threshold ${t.id} -> ${t.event}`);
});

test('validateEvent reports each kind of problem', () => {
  const { content } = newGame();
  const bad: EventDef = {
    id: 'Bad Id', tags: [], slots: { Thief: { roles: [] }, ok_slot: { roles: ['x'] } },
    beats: ['{missing} appears'],
    effects: ['npc[nope].trust +1', 'spawn npc[ok_slot] at atlantis', 'give item unobtainium', 'schedule event ghost_event in 1', 'village.gold +1'],
    requirements: { phase: ['dusk' as never], season: ['monsoon' as never], village: [{ stat: 'wealth' as never, min: 1 }] },
  };
  const errs = validateEvent(bad, content).join('\n');
  for (const needle of ['id is not snake_case', 'slot name "Thief"', 'has no roles', 'unknown placeholder {missing}', 'unknown slot "nope"', 'unknown location', 'unknown item', 'unknown event', 'unknown_effect', 'bad phase', 'bad season', 'bad village stat']) {
    assert.ok(errs.includes(needle) || errs.includes(needle.replace('unknown event', 'schedules unknown event')), `missing "${needle}" in:\n${errs}`);
  }
});

test('runEvent refuses invalid events instead of half-applying them', () => {
  const { state, content } = newGame({ npcRoles: ROLES });
  content.events['broken'] = { id: 'broken', tags: [], slots: {}, beats: [], effects: ['village.hope +1', 'flag.set Not_Valid'] };
  const r = runEvent(state, content, 'broken');
  assert.equal(r.ok, false);
  assert.equal(state.village.hope, 5);
  assert.equal(state.eventLog.length, 0);
});

/* ───────────── requirements ───────────── */

test('requirements: phase, season, day window, flags, village stats', () => {
  const { state, content } = newGame();
  const ev: EventDef = { id: 'r', tags: [], slots: {}, beats: [], effects: [], requirements: { phase: ['night'], season: ['spring'], minDay: 2, maxDay: 4, flagsAll: ['a'], flagsNone: ['b'], village: [{ stat: 'hope', min: 4, max: 6 }] } };
  content.events['r'] = ev;
  const why = () => { const r = checkRequirements(ev, state); return r.ok ? 'ok' : r.reason; };
  assert.equal(why(), 'phase');
  state.tick = dayStart(1) + 200;
  assert.equal(why(), 'min_day');
  state.tick = dayStart(2) + 200;
  assert.equal(why(), 'flag_missing:a');
  state.flags['a'] = true;
  state.flags['b'] = true;
  assert.equal(why(), 'flag_present:b');
  delete state.flags['b'];
  state.village.hope = 9;
  assert.equal(why(), 'village_hope_high');
  state.village.hope = 3;
  assert.equal(why(), 'village_hope_low');
  state.village.hope = 5;
  assert.equal(why(), 'ok');
  state.tick = dayStart(5) + 200;
  assert.equal(why(), 'max_day');
  state.startSeason = 'summer';
  state.tick = dayStart(3) + 200;
  assert.equal(why(), 'season');
});

test('cooldowns and maxRuns block repeats; force bypasses requirements but not validity', () => {
  const { state, content } = newGame({ npcRoles: ROLES });
  assert.ok(runEvent(state, content, 'midnight_theft').ok); // cooldownDays: 3
  const again = runEvent(state, content, 'midnight_theft');
  assert.deepEqual(again, { ok: false, reason: 'requirements: cooldown' });
  assert.ok(runEvent(state, content, 'midnight_theft', { force: true }).ok);
  state.tick = dayStart(5);
  assert.ok(runEvent(state, content, 'midnight_theft').ok);

  content.events['once'] = { id: 'once', tags: [], slots: {}, beats: [], effects: [], maxRuns: 1 };
  assert.ok(runEvent(state, content, 'once').ok);
  assert.deepEqual(runEvent(state, content, 'once'), { ok: false, reason: 'requirements: max_runs' });
});

/* ───────────── slots ───────────── */

test('eligibility follows each NPC\'s role in THIS run, not their card', () => {
  const { state, content } = newGame({ npcRoles: ROLES });
  const ev = content.events['midnight_theft']!;
  assert.deepEqual(eligibleNpcs(ev, 'thief', state), ['alder', 'bram', 'pip']);
  assert.deepEqual(eligibleNpcs(ev, 'victim', state), ['maren', 'tobin']);
  state.npcs['pip']!.role = 'hope';
  state.npcs['bram']!.alive = false;
  assert.deepEqual(eligibleNpcs(ev, 'thief', state), ['alder']);
  assert.deepEqual(eligibleNpcs(ev, 'nope', state), []);
});

test('enumerateAssignments lists distinct valid fillings and never reuses an NPC', () => {
  const { state, content } = newGame({ npcRoles: ROLES });
  const list = enumerateAssignments(content.events['midnight_theft']!, state);
  assert.equal(list.length, 6); // 3 thieves x 2 victims
  assert.equal(new Set(list.map((a) => JSON.stringify(a))).size, 6);
  for (const a of list) assert.notEqual(a['thief'], a['victim']);
  assert.equal(enumerateAssignments(content.events['midnight_theft']!, state, 2).length, 2);
});

test('assignSlots is deterministic for a seed and backtracks when slots compete', () => {
  const { state, content } = newGame({ npcRoles: ROLES });
  const ev = content.events['midnight_theft']!;
  assert.deepEqual(assignSlots(ev, state, new Rng(5)), assignSlots(ev, state, new Rng(5)));

  // slot "a" can only be maren; slot "b" may be maren OR tobin => b must end up tobin whatever order is tried
  const tight: EventDef = { id: 'tight', tags: [], slots: { a: { roles: ['friend'] }, b: { roles: ['friend', 'victim'] } }, beats: [], effects: [] };
  for (let seed = 0; seed < 30; seed++) assert.deepEqual(assignSlots(tight, state, new Rng(seed)), { a: 'maren', b: 'tobin' });

  const impossible: EventDef = { id: 'imp', tags: [], slots: { a: { roles: ['friend'] }, b: { roles: ['friend'] } }, beats: [], effects: [] };
  assert.equal(assignSlots(impossible, state, new Rng(1)), null);
});

test('validateAssignment rejects ineligible, duplicate, missing and extra slots', () => {
  const { state, content } = newGame({ npcRoles: ROLES });
  const ev = content.events['midnight_theft']!;
  assert.ok(validateAssignment(ev, state, { thief: 'pip', victim: 'tobin' }).ok);
  assert.deepEqual(validateAssignment(ev, state, { thief: 'edda', victim: 'tobin' }), { ok: false, reason: 'assignment_ineligible:thief' });
  assert.deepEqual(validateAssignment(ev, state, { thief: 'maren', victim: 'maren' }), { ok: false, reason: 'assignment_ineligible:thief' });
  assert.deepEqual(validateAssignment(ev, state, { thief: 'pip' }), { ok: false, reason: 'assignment_slots_mismatch' });
  assert.deepEqual(validateAssignment(ev, state, { thief: 'pip', victim: 'tobin', extra: 'bram' }), { ok: false, reason: 'assignment_slots_mismatch' });
  const dup: EventDef = { id: 'dup', tags: [], slots: { a: { roles: ['friend'] }, b: { roles: ['friend'] } }, beats: [], effects: [] };
  assert.deepEqual(validateAssignment(dup, state, { a: 'maren', b: 'maren' }), { ok: false, reason: 'assignment_duplicate_npc' });
});

/* ───────────── the headline property: same event, different slot assignments ───────────── */

test('the same event plays out differently under three different slot assignments', () => {
  const base = newGame({ npcRoles: ROLES });
  const ev = base.content.events['midnight_theft']!;
  const three = [
    { thief: 'pip', victim: 'tobin' },
    { thief: 'bram', victim: 'maren' },
    { thief: 'alder', victim: 'tobin' },
  ];
  const outcomes = three.map((assignment) => {
    const s = cloneState(base.state);
    assert.ok(validateAssignment(ev, s, assignment).ok);
    const r = runEvent(s, base.content, 'midnight_theft', { assignment });
    assert.ok(r.ok);
    return { s, entry: r.ok ? r.entry : (null as never) };
  });
  // different text
  const texts = outcomes.map((o) => o.entry.text.join(' '));
  assert.equal(new Set(texts).size, 3);
  assert.ok(texts[0]!.includes('Pip') && texts[1]!.includes('Bram') && texts[2]!.includes('Mayor Alder'));
  // trust consequences land on different NPCs
  assert.equal(outcomes[0]!.s.npcs['pip']!.trust, -2);
  assert.equal(outcomes[0]!.s.npcs['bram']!.trust, 0);
  assert.equal(outcomes[1]!.s.npcs['bram']!.trust, -2);
  assert.equal(outcomes[1]!.s.npcs['maren']!.trust, 1);
  assert.equal(outcomes[2]!.s.npcs['alder']!.trust, -2);
  // shared consequences are the same everywhere
  for (const o of outcomes) {
    assert.equal(o.s.village.fear, 4);
    assert.equal(o.s.flags['theft_reported'], true);
    assert.deepEqual(o.s.plantedClues, ['stolen_coin']);
  }
  // and the untouched base state was not modified
  assert.equal(base.state.eventLog.length, 0);
});

test('renderBeats fills placeholders from the assignment', () => {
  const { state, content } = newGame({ npcRoles: ROLES });
  void state;
  assert.deepEqual(renderBeats(content.events['bread_gift']!, content, { giver: 'maren' }), ['Maren leaves a warm loaf on your doorstep.']);
});

/* ───────────── effects at runtime ───────────── */

test('effects change the world exactly as specified', () => {
  const { state, content } = newGame({ npcRoles: ROLES });
  state.tick = 100;
  const r = runEvent(state, content, 'soup_kitchen', { assignment: { cook: 'edda' } });
  assert.ok(r.ok);
  assert.equal(state.village.hunger, 1.5); // 3 - 1.5
  assert.equal(state.village.hope, 5.5);
  assert.equal(state.npcs['edda']!.trust, 1);
  assert.deepEqual(state.npcs['edda']!.override, { location: 'meeting_hall', untilTick: dayStart(2) });

  const g = runEvent(state, content, 'bread_gift', { assignment: { giver: 'maren' } });
  assert.ok(g.ok);
  assert.equal(count(state.player.inventory, 'bread'), 2);
  assert.equal(state.village.hope, 6.5);
});

test('dilemmas and clues are not duplicated; runs and log are recorded', () => {
  const { state, content } = newGame({ npcRoles: ROLES });
  state.tick = dayStart(2);
  assert.ok(runEvent(state, content, 'hoard_found').ok);
  state.flags = {}; // allow a second run for the test
  assert.ok(runEvent(state, content, 'hoard_found').ok);
  assert.deepEqual(state.pendingDilemmas, ['confront_hoarder']);
  assert.equal(state.eventRuns['hoard_found'], 2);
  assert.equal(state.eventLog.length, 2);
  assert.ok(['alder', 'bram'].includes(state.eventLog[0]!.assignment['hoarder']!)); // hoarder or swindler
});

test('items that do not fit are dropped, never crash', () => {
  const { state, content } = newGame({ npcRoles: ROLES, startItems: [{ item: 'bread', qty: 10 }] });
  state.player.inventory.slots = 1;
  assert.ok(runEvent(state, content, 'bread_gift', { assignment: { giver: 'maren' } }).ok);
  assert.equal(count(state.player.inventory, 'bread'), 10);
});

test('Director-chosen assignments are validated before running', () => {
  const { state, content } = newGame({ npcRoles: ROLES });
  const r = runEvent(state, content, 'midnight_theft', { assignment: { thief: 'edda', victim: 'tobin' } });
  assert.equal(r.ok, false);
  assert.equal(state.eventLog.length, 0);
  assert.equal(state.village.fear, 3);
});

test('no valid assignment means the event does not run', () => {
  const { state, content } = newGame({ npcRoles: { ...ROLES, pip: 'hope', bram: 'impostor', alder: 'traitor' } });
  assert.deepEqual(runEvent(state, content, 'midnight_theft'), { ok: false, reason: 'no_valid_assignment' });
});

/* ───────────── scheduling ───────────── */

test('a scheduled phase-gated event waits for the right phase on the same day', () => {
  const { state, content } = newGame({ npcRoles: ROLES });
  scheduleEvent(state, 'night_watch', 1, 'director');
  advance(state, content, 100, 'idle');
  assert.equal(state.eventLog.length, 0);
  assert.equal(state.scheduled.length, 1);
  advance(state, content, 100, 'idle'); // now past tick 192
  assert.equal(state.eventLog.length, 1);
  assert.equal(state.eventLog[0]!.eventId, 'night_watch');
  assert.equal(state.eventLog[0]!.tick, 192);
  assert.equal(state.scheduled.length, 0);
});

test('an event that can never run is dropped after three blocked days and logged', () => {
  const { state, content } = newGame({ npcRoles: ROLES });
  content.events['never'] = { id: 'never', tags: [], slots: {}, beats: [], effects: [], requirements: { flagsAll: ['impossible'] } };
  scheduleEvent(state, 'never', 1, 'director');
  advance(state, content, 240 * 5, 'idle');
  assert.equal(state.scheduled.length, 0);
  assert.equal(state.skipped.length, 1);
  assert.equal(state.skipped[0]!.eventId, 'never');
  assert.equal(state.skipped[0]!.day, 3);
  assert.match(state.skipped[0]!.reason, /flag_missing/);
});

test('future events wait for their day; due events run in a stable order', () => {
  const { state, content } = newGame({ npcRoles: ROLES });
  content.events['zeta'] = { id: 'zeta', tags: [], slots: {}, beats: [], effects: [] };
  content.events['alpha'] = { id: 'alpha', tags: [], slots: {}, beats: [], effects: [] };
  scheduleEvent(state, 'zeta', 1, 'director');
  scheduleEvent(state, 'alpha', 1, 'director');
  scheduleEvent(state, 'festival', 3, 'director');
  const ran = runDueEvents(state, content);
  assert.deepEqual(ran.map((e) => e.eventId), ['alpha', 'zeta']);
  assert.equal(state.scheduled.length, 1);
  advance(state, content, dayStart(3) - state.tick, 'idle');
  assert.ok(state.eventLog.some((e) => e.eventId === 'festival' && e.day === 3));
});

test('self-scheduling loops cannot hang the engine', () => {
  const { state, content } = newGame({ npcRoles: ROLES });
  content.events['loop'] = { id: 'loop', tags: [], slots: {}, beats: [], effects: ['schedule event loop in 0'] };
  scheduleEvent(state, 'loop', 1, 'director');
  const ran = runDueEvents(state, content);
  assert.ok(ran.length <= 20);
});
