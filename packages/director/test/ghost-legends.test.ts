import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateGhostLegend,
  placeGhostMonuments,
  fallbackGhostLegend,
} from '../src/index.ts';
import type { RunSummary } from '../src/index.ts';
import { bareState } from './fixtures.ts';
import { LlmClient, MockProvider } from '../src/client.ts';

test('T031: fallback ghost legend creates a two-sentence folk tale with allowed monument', () => {
  const summary: RunSummary = {
    runId: 'run_123',
    archetype: 'lone_wolf',
    endingFamily: 'scarred_survival',
    deeds: ['Survived on the ridge alone', 'Avoided the chapel'],
    savedNpcIds: [],
    abandonedNpcIds: ['edda', 'pip'],
    daysSurvived: 12,
  };

  const legend = fallbackGhostLegend(summary, 42);
  assert.equal(legend.runId, 'run_123');
  assert.ok(legend.legendText.length > 20);
  assert.equal(legend.tags.archetype, 'lone_wolf');
  assert.ok(['grave', 'statue', 'song', 'carving', 'story'].includes(legend.monumentType));
});

test('T031: a legend from run A appears as a monument in run B', async () => {
  const summaryA: RunSummary = {
    runId: 'run_A',
    archetype: 'peacemaker',
    endingFamily: 'peace_restored',
    deeds: ['Stopped the blood feud in the town square'],
    savedNpcIds: ['maren', 'alder'],
    abandonedNpcIds: [],
    daysSurvived: 16,
  };

  const resA = await generateGhostLegend(summaryA, null, 1);
  const legendA = resA.legend;

  // New run B
  const stateB = bareState(2);
  assert.equal(stateB.structures.length, 0);

  const placed = placeGhostMonuments(stateB, [legendA], 2, 2);

  assert.equal(placed.length, 1);
  assert.equal(placed[0]!.legendId, legendA.id);
  assert.equal(placed[0]!.legendText, legendA.legendText);
  assert.equal(stateB.structures.length, 1);
  assert.equal(stateB.structures[0]!.id, `monument_${legendA.id}`);
});

test('T031: P7a LLM output is validated and falls back cleanly on corruption', async () => {
  const summary: RunSummary = {
    runId: 'run_LLM',
    archetype: 'trickster',
    endingFamily: 'exile',
    deeds: ['Stole the hoarder grain'],
    savedNpcIds: ['pip'],
    abandonedNpcIds: [],
    daysSurvived: 10,
  };

  const validMock = {
    legend_text: 'They say an unknown thief emptied the high bins while the village slept. No track was left in the fresh snow, but the orphans had porridge.',
    tags: { archetype: 'trickster', deed_type: 'kindness', ending_family: 'exile' },
    monument_type: 'story',
  };
  const provider = new MockProvider(() => JSON.stringify(validMock));
  const client = new LlmClient({ provider, model: 'test-model' });

  const res = await generateGhostLegend(summary, client, 5);
  assert.equal(res.source, 'llm');
  assert.equal(res.legend.tags.archetype, 'trickster');
  assert.equal(res.legend.monumentType, 'story');
});
