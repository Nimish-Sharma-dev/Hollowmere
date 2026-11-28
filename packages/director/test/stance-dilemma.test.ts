import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DILEMMA_TEMPLATES,
  resolveDilemma,
  newArchetypeTracker,
  recordArchetypeAction,
  getDominantArchetype,
  getNormalizedArchetypeScores,
  newDirectorMemory,
  quotaViolation,
  stressSignals,
  fallbackDirector,
} from '../src/index.ts';
import { content, lore, newState } from './fixtures.ts';

test('T029: dilemma resolution applies stats, trust, flags, and archetype scores', () => {
  const { state } = newState(10);
  const tracker = newArchetypeTracker();

  state.pendingDilemmas.push('confront_hoarder');

  const initialHope = state.village.hope;
  const res = resolveDilemma(state, 'confront_hoarder', 'distribute_food', tracker);

  assert.equal(res.ok, true);
  assert.equal(state.pendingDilemmas.includes('confront_hoarder'), false);
  assert.ok(state.flags['hoard_distributed']);
  assert.equal(state.village.hope, initialHope + 2);

  assert.equal(tracker.scores.shepherd, 3);
  assert.equal(tracker.scores.peacemaker, 2);
  assert.equal(getDominantArchetype(tracker), 'shepherd');

  const normalized = getNormalizedArchetypeScores(tracker);
  assert.equal(normalized.shepherd, 0.6);
  assert.equal(normalized.peacemaker, 0.4);
});

test('T029: stress signals and lifelines are offered when player or village is in crisis', () => {
  const { state, bible } = newState(11);
  const memory = newDirectorMemory();

  // Player healthy, tension normal
  const normalSignals = stressSignals(state, memory);
  assert.equal(normalSignals.nearCollapse, false);

  // Severe player distress
  state.player.stats.health = 20;
  const distressSignals = stressSignals(state, memory);
  assert.equal(distressSignals.nearCollapse, true);

  // Director prioritizes lifeline
  const out = fallbackDirector({
    state,
    content,
    lore,
    bible,
    memory,
    decision: { kind: 'day_start', day: 2 },
    seed: 55,
  });

  assert.ok(out);
  assert.equal(out.stance, 'mirror');
  assert.ok(out.diagnosis.includes('collapse') || out.diagnosis.includes('lifeline'));
});

test('T029: quota violations are enforced only after minimum decision threshold', () => {
  const memory = newDirectorMemory();

  // Under minimum 8 decisions, no violation
  memory.stanceCounts.mirror = 4;
  memory.stanceCounts.challenge = 1;
  memory.stanceCounts.wildcard = 0;
  assert.equal(quotaViolation(memory, 'mirror'), false);

  // Over minimum decisions with excessive mirror skew
  memory.stanceCounts.mirror = 10;
  memory.stanceCounts.challenge = 1;
  memory.stanceCounts.wildcard = 0;
  assert.equal(quotaViolation(memory, 'mirror'), true);
});
