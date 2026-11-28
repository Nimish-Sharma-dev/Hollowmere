import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  newVillageMemoryStore,
  processEventMemories,
  advanceRumorsDaily,
  mutateRumorText,
  RUMOR_MUTATIONS,
  LlmClient,
  MockProvider,
} from '../src/index.ts';
import { content, newState } from './fixtures.ts';
import { Rng } from '../../engine/src/rng.ts';

test('T028: rumor text mutates according to allowed mutation rules', () => {
  const rng = new Rng(42);
  const base = 'The stranger took food from the chapel.';
  for (const m of RUMOR_MUTATIONS) {
    const mutated = mutateRumorText(base, m, rng);
    assert.ok(mutated.length > 0);
    assert.notEqual(mutated, base);
  }
});

test('T028: memories are subjective based on NPC trust and capped at 10', async () => {
  const { state } = newState(1);
  const store = newVillageMemoryStore();

  // Set Maren to hate the player and Pip to trust the player
  state.npcs['maren']!.trust = -3;
  state.npcs['pip']!.trust = 3;

  const res = await processEventMemories(
    'Player traded with a strange merchant',
    ['maren', 'pip'],
    state,
    content,
    store,
    1,
    1,
    42,
    null
  );

  assert.equal(res.output.memories.length, 2);
  const marenMem = store.memories['maren']![0]!;
  const pipMem = store.memories['pip']![0]!;

  assert.equal(marenMem.valence, -1);
  assert.equal(pipMem.valence, 1);

  // Test 10-memory cap per NPC
  for (let i = 0; i < 15; i++) {
    await processEventMemories(`Event number ${i}`, ['pip'], state, content, store, i, i, i, null);
  }
  assert.equal(store.memories['pip']!.length, 10);
});

test('T028: a rumor mutates across simulated days and updates the journal', async () => {
  const { state } = newState(2);
  const store = newVillageMemoryStore();

  await processEventMemories(
    'A shadowy figure was seen lurking near the well',
    ['edda'],
    state,
    content,
    store,
    1,
    5,
    99,
    null
  );

  assert.equal(store.activeRumors.length, 1);
  const initialText = store.activeRumors[0]!.text;
  assert.equal(store.journal.rumorsHeard.length, 1);
  assert.equal(store.journal.rumorsHeard[0], initialText);

  // Day 2
  advanceRumorsDaily(store, 100);
  const day2Text = store.activeRumors[0]!.text;
  assert.notEqual(day2Text, initialText);

  // Day 3
  advanceRumorsDaily(store, 101);
  const day3Text = store.activeRumors[0]!.text;
  assert.notEqual(day3Text, day2Text);
});

test('T028: P5 model output is validated and applied when LLM client is provided', async () => {
  const { state } = newState(3);
  const store = newVillageMemoryStore();

  const mockP5 = {
    memories: [{ npc_id: 'maren', fact: 'Saw the outsider light a fire', valence: 0 }],
    rumors: [
      {
        text: 'The foreigner knows how to summon flames in the dark.',
        mutation: 'exaggerate',
        origin_npc_id: 'maren',
        spreads_to: ['pip', 'tobin'],
        accuracy: 0.5,
        points_to_secret_id: null,
      },
    ],
  };

  const provider = new MockProvider(() => JSON.stringify(mockP5));
  const client = new LlmClient({ provider, model: 'test-model' });

  const res = await processEventMemories(
    'Player made a campfire',
    ['maren'],
    state,
    content,
    store,
    1,
    1,
    123,
    client
  );

  assert.equal(res.source, 'llm');
  assert.equal(store.memories['maren']![0]!.fact, 'Saw the outsider light a fire');
  assert.equal(store.activeRumors[0]!.mutation, 'exaggerate');
});
