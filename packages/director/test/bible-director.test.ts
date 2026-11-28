import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFallbackBible, validateRunBible, judgeDivergence, divergenceGate, checkFingerprint, distance, drawSeed, lintLore, makeLore, profileKeyOf, listEligible, fallbackDirector, validateDirectorOutput, classify, newDirectorMemory, quotaViolation, stressSignals } from '../src/index.ts';
import type { RunBible, DirectorInput, DirectorOutput, RecentRun, OnboardingProfile } from '../src/index.ts';
import { Rng } from '../../engine/src/rng.ts';
import { content, lore, newBible, newState } from './fixtures.ts';
import { ARCHETYPES } from '../src/schemas.ts';

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const ctx = { content, lore };

function randomProfile(rng: Rng): OnboardingProfile {
  const scores = Object.fromEntries(ARCHETYPES.map((a) => [a, Math.round(rng.next() * 100) / 100])) as OnboardingProfile['archetype_scores'];
  return { values: ['loyalty'], fears: ['cold'], archetype_scores: scores, core_motivation: rng.pick(['safety', 'power', 'freedom', 'home'] as const), backstory_seed: 'x', contradiction: null, story_hook: 'y', spawn_preference: { spawn_id: rng.pick(Object.keys(lore.spawns).sort()), reason: 'r' }, starting_kit_id: rng.pick(Object.keys(lore.kits).sort()) };
}

/* ───────────── lore + seed + fingerprint ───────────── */

test('the story library passes its own lint (secrets with 2+ clues in different places, 6+ events per crisis, ...)', () => {
  assert.deepEqual(lintLore(lore, content), []);
});

test('lore lint catches broken libraries', () => {
  const l = makeLore();
  l.secrets['grain_cellar']!.clueIds = ['grain_sacks'];
  l.clues['ledger_gap']!.locationIds = ['atlantis', 'village_gate'];
  l.crises['poisoned_well']!.eventTag = 'crisis_nothing';
  l.kits['forager']!.items.push({ item: 'unobtainium', qty: 1 });
  delete l.roleMotives['friend'];
  l.secrets['night_rites']!.crisisIds = ['nonexistent_crisis'];
  const e = lintLore(l, content).join('\n');
  for (const needle of ['secret grain_cellar: needs at least 2 clues', 'unknown location atlantis', 'crisis poisoned_well: only 0 event(s)', 'kit forager: unknown item unobtainium', 'role friend: no hidden motive', 'unknown crisis nonexistent_crisis', 'no secret fits antagonist role']) assert.ok(e.includes(needle), needle);
});

test('seed draws are deterministic and never reuse a lens from the last 3 runs', () => {
  const ids = Object.keys(content.npcs);
  assert.deepEqual(drawSeed(new Rng(4), ids, lore.seasons), drawSeed(new Rng(4), ids, lore.seasons));
  for (let i = 0; i < 300; i++) {
    const recent = ['tragedy', 'mystery', 'heist'];
    const d = drawSeed(new Rng(i), ids, lore.seasons, recent);
    assert.ok(!recent.includes(d.lens));
    assert.ok(ids.includes(d.spotlight_npc) && lore.seasons.includes(d.weather_season));
  }
});

test('fingerprint distance and the two anti-repetition rules', () => {
  const a = { crisis_id: 'c1', antagonist_npc_id: 'n1', ending_family: 'e1', tone: 't1', twist_id: 'w1' };
  assert.equal(distance(a, a), 0);
  assert.equal(distance(a, { ...a, tone: 't2', twist_id: 'w2' }), 2);
  const recents: RecentRun[] = [{ fingerprint: { ...a, tone: 't2', twist_id: 'w2' }, profileKey: 'safety:shepherd' }];
  assert.equal(checkFingerprint(a, 'safety:shepherd', recents).ok, false); // distance 2 < 3 for a similar profile
  assert.equal(checkFingerprint(a, 'power:tyrant', recents).ok, true); // distance 2 >= 2 overall, different profile
  assert.equal(checkFingerprint(a, 'power:tyrant', [{ fingerprint: { ...a, tone: 't2' }, profileKey: 'power:tyrant' }]).ok, false); // distance 1 < 2
  assert.equal(checkFingerprint(a, 'x', []).ok, true);
  // only the last 30 matter
  const old: RecentRun[] = [{ fingerprint: a, profileKey: 'x' }, ...Array.from({ length: 30 }, () => ({ fingerprint: { crisis_id: 'z', antagonist_npc_id: 'z', ending_family: 'z', tone: 'z', twist_id: 'z' }, profileKey: 'x' }))];
  assert.equal(checkFingerprint(a, 'x', old).ok, true);
});

/* ───────────── Run Bible: builder + validator ───────────── */

test('the fallback builder is deterministic and its bible passes the validator', () => {
  const a = buildFallbackBible(content, lore, { seed: 12 });
  const b = buildFallbackBible(content, lore, { seed: 12 });
  assert.deepEqual(a.bible, b.bible);
  const v = validateRunBible(a.bible, { ...ctx, profileKey: a.profileKey, seedDraw: a.seedDraw });
  assert.deepEqual(v.errors, []);
  assert.notDeepEqual(buildFallbackBible(content, lore, { seed: 13 }).bible, a.bible);
});

test('a bible has exactly one villain, every NPC cast once, 4 distinct candidates, 2+ clues in different places, 3+ opinions', () => {
  for (let s = 1; s <= 40; s++) {
    const b = newBible(s);
    assert.equal(b.cast_roles.length, Object.keys(content.npcs).length);
    assert.equal(b.candidates.length, 4);
    const crisis = lore.crises[b.crisis.crisis_id]!;
    assert.equal(b.cast_roles.filter((c) => crisis.antagonistRoles.includes(c.role_id)).length, 1);
    assert.ok(new Set(b.crisis.clues.map((c) => c.location_id)).size >= 2);
    assert.ok(b.cast_roles.filter((c) => c.initial_attitude !== 0).length >= 3);
    assert.ok(b.secrets.length >= 2 && b.secrets.every((x) => x.clue_ids.length >= 2));
    assert.ok(b.secrets.some((x) => x.holder_npc_id === b.fingerprint.antagonist_npc_id));
    // every secret fits the crisis: the villain's by design, side secrets are generic or fit this crisis
    for (const x of b.secrets) {
      const def = lore.secrets[x.secret_id]!;
      if (x.holder_npc_id === b.fingerprint.antagonist_npc_id) assert.ok(def.crisisIds.includes(b.crisis.crisis_id), `${x.secret_id} in ${b.crisis.crisis_id}`);
      else assert.ok(def.crisisIds.length === 0 || def.crisisIds.includes(b.crisis.crisis_id));
    }
  }
});

test('every NPC can be the villain in some crisis, and over many runs each of them is (variety)', () => {
  const rng = new Rng(5);
  const villains: Record<string, number> = {};
  const recents: RecentRun[] = [];
  for (let i = 0; i < 400; i++) {
    const r = buildFallbackBible(content, lore, { seed: i + 1, recents, profile: randomProfile(rng) });
    const v = r.bible.fingerprint.antagonist_npc_id;
    villains[v] = (villains[v] ?? 0) + 1;
    recents.push({ fingerprint: r.bible.fingerprint, profileKey: r.profileKey });
  }
  for (const id of Object.keys(content.npcs)) assert.ok((villains[id] ?? 0) >= 10, `${id} was the villain only ${villains[id] ?? 0} times: ${JSON.stringify(villains)}`);
});

test('openings use each NPC\'s own arrival sentence, never a stitched-together tic', () => {
  for (let s = 1; s <= 60; s++) {
    const b = newBible(s);
    for (const c of b.cast_roles) assert.equal(c.first_impression_line, content.npcs[c.npc_id]!.arrival);
    assert.ok(!b.opening_narration.includes('and watches you arrive'));
    assert.ok(Object.values(content.npcs).some((n) => b.opening_narration.includes(n.arrival!)), 'opening ends with an arrival line');
  }
});

test('a villain\'s hidden motive does not just repeat their secret', () => {
  const sig = (t: string): Set<string> => new Set(t.toLowerCase().match(/[a-z]{5,}/g) ?? []);
  for (let s = 1; s <= 200; s++) {
    const b = newBible(s);
    const v = b.cast_roles.find((c) => c.npc_id === b.fingerprint.antagonist_npc_id)!;
    const secret = b.secrets.find((x) => x.holder_npc_id === v.npc_id)!;
    const a = sig(v.hidden_motive);
    const shared = [...sig(secret.truth)].filter((w) => a.has(w));
    assert.ok(shared.length <= 1, `seed ${s}: motive "${v.hidden_motive}" repeats secret "${secret.truth}" (${shared.join(', ')})`);
  }
});

test('the validator rejects each rule violation', () => {
  const base = buildFallbackBible(content, lore, { seed: 21 });
  const v = (mutate: (b: RunBible) => void, extra = {}): string => {
    const b = clone(base.bible);
    mutate(b);
    const r = validateRunBible(b, { ...ctx, profileKey: base.profileKey, seedDraw: base.seedDraw, ...extra });
    assert.equal(r.ok, false);
    return r.errors.join(' | ');
  };
  const villain = base.bible.fingerprint.antagonist_npc_id;
  assert.match(v((b) => void (b.crisis.crisis_id = 'moon_crisis')), /unknown crisis/);
  assert.match(v((b) => void (b.cast_roles[0]!.role_id = 'wizard')), /cannot take role wizard/);
  assert.match(v((b) => void b.cast_roles.pop()), /missing/);
  assert.match(v((b) => void b.cast_roles.push(clone(b.cast_roles[0]!))), /duplicate NPC/);
  assert.match(v((b) => void (b.fingerprint.antagonist_npc_id = b.cast_roles.find((c) => c.npc_id !== villain)!.npc_id)), /antagonist/);
  assert.match(v((b) => void (b.secrets[0]!.clue_ids = [b.secrets[0]!.clue_ids[0]!])), /at least 2 clues|needs at least 2/);
  assert.match(v((b) => void (b.secrets.find((s) => s.holder_npc_id === villain)!.holder_npc_id = 'nobody')), /cannot hold|unknown/);
  assert.match(v((b) => void b.crisis.clues.forEach((c) => (c.location_id = 'forge'))), /cannot be placed|2 different places/);
  assert.match(v((b) => void (b.crisis.clues[0]!.location_id = 'atlantis')), /unknown location|cannot be placed/);
  assert.match(v((b) => void b.relationship_graph.push({ a: villain, b: villain, type: 'loves', strength: 3 })), /self-loop/);
  assert.match(v((b) => void b.cast_roles.forEach((c) => (c.initial_attitude = 0))), /non-zero initial attitude/);
  assert.match(v((b) => void (b.candidates[1] = clone(b.candidates[0]!))), /distinct/);
  assert.match(v((b) => void (b.chosen = 'Z')), /not a candidate/);
  assert.match(v((b) => void (b.fingerprint.tone = b.candidates.find((c) => c.tone !== b.fingerprint.tone)?.tone ?? 'fable')), /fingerprint|tone/);
  assert.match(v((b) => void (b.start.village_stats.hope = 11)), /outside 0\.\.10/);
  assert.match(v((b) => void (b.crisis.crisis_id = b.crisis.crisis_id === 'poisoned_well' ? 'chapel_cult' : 'poisoned_well')), /does not fit crisis|does not suit/);
  assert.match(v((b) => void (b.opening_narration += ` ${base.seedDraw.forbidden_trope}`)), /forbidden trope/);
  assert.match(v((_b) => {}, { recents: [{ fingerprint: base.bible.fingerprint, profileKey: base.profileKey }] }), /fingerprint: distance/);
  assert.match(v((b) => void ((b as unknown as Record<string, unknown>)['surprise'] = 1)), /unexpected key/);
});

test('onboarding profiles steer spawn and kit, and make the profile key', () => {
  const p = { ...randomProfile(new Rng(1)), spawn_preference: { spawn_id: 'hurt_at_chapel', reason: 'r' }, starting_kit_id: 'healer' };
  const r = buildFallbackBible(content, lore, { seed: 5, profile: p });
  assert.equal(r.bible.start.spawn_id, 'hurt_at_chapel');
  assert.equal(r.bible.start.kit_id, 'healer');
  assert.match(profileKeyOf(p), /^(safety|power|freedom|home):/);
  assert.equal(profileKeyOf(null), 'none');
});

test('1,000 bibles with realistic player profiles: all valid, none relaxed, all four crises used, divergence gate passes (T019)', () => {
  const rng = new Rng(2026);
  const recents: RecentRun[] = [];
  const lenses: string[] = [];
  const bibles: RunBible[] = [];
  const crises = new Set<string>();
  for (let i = 0; i < 1000; i++) {
    const profile = randomProfile(rng);
    const r = buildFallbackBible(content, lore, { seed: i + 1, recents, profile, recentLenses: lenses });
    const v = validateRunBible(r.bible, { ...ctx, recents, profileKey: r.profileKey, seedDraw: r.seedDraw });
    assert.deepEqual(v.errors, [], `bible ${i}`);
    assert.equal(r.relaxed, false, `bible ${i} had to relax the fingerprint rules`);
    crises.add(r.bible.crisis.crisis_id);
    recents.push({ fingerprint: r.bible.fingerprint, profileKey: r.profileKey });
    lenses.push(r.seedDraw.lens);
    bibles.push(r.bible);
  }
  assert.equal(crises.size, 4);
  const gate = divergenceGate(bibles, 2000, new Rng(9));
  assert.ok(gate.pass, JSON.stringify(gate));
  assert.ok(gate.meanAverage >= 6 && gate.samePct <= 10);
});

test('without any onboarding profile the builder never goes below the overall distance rule', () => {
  const recents: RecentRun[] = [];
  for (let i = 0; i < 200; i++) {
    const r = buildFallbackBible(content, lore, { seed: i + 1, recents });
    assert.ok(r.check.overallMin >= 2, `run ${i}: overall distance ${r.check.overallMin}`);
    recents.push({ fingerprint: r.bible.fingerprint, profileKey: r.profileKey });
  }
});

test('the mock divergence judge scores identical bibles low and different ones high, in the P8 shape', () => {
  const a = newBible(1);
  const same = judgeDivergence(a, a);
  assert.equal(same.would_players_say_same_game, true);
  assert.ok(same.average < 4 && same.shared_elements.length >= 3);
  let best = 0;
  for (let s = 2; s < 30; s++) best = Math.max(best, judgeDivergence(a, newBible(s)).average);
  assert.ok(best > 6);
});

/* ───────────── Director ───────────── */

/** first seed (scanning upward) whose opening state has at least 3 eligible events */
function input(over: Partial<DirectorInput> = {}): DirectorInput {
  for (let seed = 1; seed < 200; seed++) {
    const { state, bible } = newState(seed);
    if (listEligible(state, content).length >= 3) return { state, content, lore, bible, memory: newDirectorMemory(), decision: { kind: 'day_start', day: 1 }, seed, ...over };
  }
  throw new Error('no seed with 3 eligible events');
}

test('eligible events exclude threshold events, unmet requirements and unfillable slots', () => {
  const { state } = newState(5);
  const ids = listEligible(state, content).map((e) => e.id);
  assert.ok(ids.length >= 1);
  assert.ok(!ids.includes('festival') && !ids.includes('famine')); // threshold events
  assert.ok(!ids.includes('night_watch')); // needs night phase
  assert.ok(!ids.includes('hoard_found')); // needs day 2+
  for (const e of listEligible(state, content)) for (const c of Object.values(e.slots)) assert.ok(c.length >= 1);
});

test('the fallback Director returns exactly the P3 shape, valid, deterministic, with a real slot assignment', () => {
  const i = input();
  const a = fallbackDirector(i)!;
  assert.deepEqual(a, fallbackDirector(i));
  const eligible = listEligible(i.state, content);
  const v = validateDirectorOutput(a, { state: i.state, content, lore, eligible, memory: i.memory });
  assert.deepEqual(v.errors, []);
  assert.equal(a.options_considered.length, 3);
  assert.equal(new Set(a.options_considered.map((o) => o.event_id)).size, Math.min(3, eligible.length));
  assert.equal(a.tone, i.bible.fingerprint.tone);
});

test('the Director validator rejects invented ids, bad assignments, quota breaks and not-yet-built features', () => {
  const i = input();
  const good = fallbackDirector(i)!;
  const eligible = listEligible(i.state, content);
  const check = (mutate: (o: DirectorOutput) => void, memory = i.memory): string => {
    const o = clone(good);
    mutate(o);
    const r = validateDirectorOutput(o, { state: i.state, content, lore, eligible, memory });
    assert.equal(r.ok, false);
    return r.errors.join(' | ');
  };
  assert.match(check((o) => void (o.chosen_event_id = 'summon_dragon')), /not eligible/);
  assert.match(check((o) => void (o.options_considered[0]!.event_id = 'summon_dragon')), /not eligible/);
  assert.match(check((o) => void (o.options_considered[1] = clone(o.options_considered[0]!))), /distinct/);
  assert.match(check((o) => void (o.slot_assignments = { thief: 'edda', victim: 'maren' })), /slot_assignments|ineligible|mismatch/);
  assert.match(check((o) => void (o.stance = o.stance === 'mirror' ? 'challenge' : 'mirror')), /stance/);
  assert.match(check((o) => void (o.npc_spawns = ['ghost'])), /unknown NPC/);
  assert.match(check((o) => void (o.tone = 'slapstick')), /unknown tone/);
  assert.match(check((o) => void (o.foreshadow_clue_id = 'not_a_clue')), /unknown foreshadow clue/);
  assert.match(check((o) => void (o.dilemma_template_id = 'dilemma_1')), /dilemma_template_id/);
  assert.match(check((o) => void (o.rumor_seed = 'a rumor')), /rumor_seed/);
  assert.match(check((o) => void (o.plan_ahead = ['one'])), /at least 2/);
  const skewed = { beats: [], stanceCounts: { mirror: 0, challenge: 0, wildcard: 0 }, foreshadowed: false };
  skewed.stanceCounts[good.stance] = 20;
  assert.match(check(() => {}, skewed), /quota/);
  // difficulty is clamped, not rejected
  const loud = clone(good);
  loud.difficulty_adjust = 9;
  const ok = validateDirectorOutput(loud, { state: i.state, content, lore, eligible, memory: i.memory });
  assert.ok(ok.ok && ok.output!.difficulty_adjust === 2);
});

test('quota enforcement only starts after 8 decisions and uses a 25-point tolerance', () => {
  const m = newDirectorMemory();
  m.stanceCounts.mirror = 6;
  assert.equal(quotaViolation(m, 'mirror'), false); // 6 decisions: too early
  m.stanceCounts.mirror = 9;
  assert.equal(quotaViolation(m, 'mirror'), true);
  m.stanceCounts = { mirror: 4, challenge: 4, wildcard: 2 };
  assert.equal(quotaViolation(m, 'challenge'), false);
});

test('stance classification: kindness mirrors, crimes challenge, mysteries are wildcards, behaviour overrides', () => {
  assert.equal(classify(['kindness'], []), 'mirror');
  assert.equal(classify(['crime'], []), 'challenge');
  assert.equal(classify(['mystery'], []), 'wildcard');
  assert.equal(classify(['crime'], ['crime']), 'mirror');
});

test('when the player is close to collapse the Director offers a lifeline', () => {
  const i = input();
  i.state.player.stats.hunger = 5;
  i.state.player.stats.health = 20;
  assert.equal(stressSignals(i.state, i.memory).nearCollapse, true);
  for (let s = 1; s <= 25; s++) {
    const out = fallbackDirector({ ...i, seed: s })!;
    const tags = content.events[out.chosen_event_id]!.tags;
    assert.ok(tags.includes('relief') || tags.includes('kindness'), `seed ${s} picked ${out.chosen_event_id}`);
    assert.equal(out.difficulty_adjust, -1);
  }
});

test('anti-repeat: never picks the same event twice in a row, and avoids events sharing tags with 2 of the last 3 beats', () => {
  const i = input();
  const beats = [
    { event_id: 'midnight_theft', tags: ['crime', 'crisis_hoarded_stores'], stance: 'challenge' as const, day: 1 },
    { event_id: 'rival_challenge', tags: ['crime', 'conflict'], stance: 'challenge' as const, day: 1 },
  ];
  for (let s = 1; s <= 30; s++) {
    const out = fallbackDirector({ ...i, seed: s, memory: { ...newDirectorMemory(), beats } })!;
    assert.notEqual(out.chosen_event_id, 'midnight_theft');
    assert.ok(!content.events[out.chosen_event_id]!.tags.includes('crime'), 'two recent crime beats should rule out more crime');
  }
});
