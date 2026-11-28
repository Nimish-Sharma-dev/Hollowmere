import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MODIFIER_LIBRARY,
  fallbackDailyModifier,
  resolveDailyModifier,
  applyDailyModifier,
} from '../src/index.ts';
import { bareState } from './fixtures.ts';
import { LlmClient, MockProvider } from '../src/client.ts';
import type { Id } from '../../shared/src/index.ts';

test('T030: fallback daily modifier never repeats an item in the last 7 days', () => {
  const lastSeven: Id[] = [
    'blood_moon',
    'heavy_snowfall',
    'market_day',
    'fog_of_doubt',
    'bountiful_harvest',
    'howling_winds',
    'silent_bell',
  ];

  for (let seed = 1; seed <= 20; seed++) {
    const mod = fallbackDailyModifier('2026-11-29', lastSeven, seed);
    assert.equal(lastSeven.includes(mod.modifier_id), false);
    assert.ok(MODIFIER_LIBRARY[mod.modifier_id]);
    assert.ok(mod.town_crier_line.length > 0);
  }
});

test('T030: daily modifier effects apply to game state', () => {
  const state = bareState(10);
  const initialTempOffset = state.modifiers.tempOffset;

  const mod = MODIFIER_LIBRARY['heavy_snowfall']!;
  applyDailyModifier(state, {
    modifier_id: 'heavy_snowfall',
    town_crier_line: mod.townCrierLine,
    flavour_line: mod.flavourLine,
    mood_colour_id: mod.moodColourId,
  });

  assert.equal(state.modifiers.id, 'heavy_snowfall');
  assert.equal(state.modifiers.tempOffset, initialTempOffset - 6);
  assert.equal(state.modifiers.hungerMult > 1, true);
});

test('T030: LLM client P6 output is validated and falls back cleanly if corrupted', async () => {
  // Valid LLM output
  const validMock = {
    modifier_id: 'market_day',
    town_crier_line: 'Peddlers arrive!',
    flavour_line: 'Smells of roasted nuts.',
    mood_colour_id: 'warm_gold',
  };
  const provider = new MockProvider(() => JSON.stringify(validMock));
  const client = new LlmClient({ provider, model: 'test-model' });

  const res = await resolveDailyModifier('2026-11-30', ['blood_moon'], client, 1);
  assert.equal(res.source, 'llm');
  assert.equal(res.output.modifier_id, 'market_day');

  // Corrupted / invalid id output falls back
  const badMock = {
    modifier_id: 'summon_aliens',
    town_crier_line: 'Aliens!',
    flavour_line: 'Strange lights.',
    mood_colour_id: 'neon',
  };
  const badProvider = new MockProvider(() => JSON.stringify(badMock));
  const badClient = new LlmClient({ provider: badProvider, model: 'test-model' });

  const fallbackRes = await resolveDailyModifier('2026-11-30', ['blood_moon'], badClient, 1);
  assert.equal(fallbackRes.source, 'fallback');
  assert.ok(MODIFIER_LIBRARY[fallbackRes.output.modifier_id]);
});
