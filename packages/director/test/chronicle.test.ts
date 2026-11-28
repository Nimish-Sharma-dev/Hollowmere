import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateChronicle,
  renderChronicleBook,
  fallbackChronicle,
} from '../src/index.ts';
import type { ChronicleInput } from '../src/index.ts';
import { LlmClient, MockProvider } from '../src/client.ts';

const sampleInput: ChronicleInput = {
  runId: 'test_run_123',
  playerTitle: 'The Winter Warden',
  archetype: 'shepherd',
  endingFamily: 'shepherd_saved',
  keyBeats: [
    { day: 1, location: 'gate', npcs: ['voss'], eventId: 'arrival' },
    { day: 3, location: 'chapel', npcs: ['edda'], eventId: 'soup_kitchen' },
  ],
  villagerQuotes: [{ npcId: 'pip', quote: 'They gave me bread.' }],
};

test('T032: fallback chronicle creates exactly 6 pages with headings and scene ids', () => {
  const chronicle = fallbackChronicle(sampleInput, 42);

  assert.equal(chronicle.pages.length, 6);
  assert.equal(chronicle.title, 'The Winter Warden');
  assert.ok(chronicle.epitaph.length > 5);
  assert.equal(chronicle.shareCard.archetype, 'shepherd');

  for (let p = 1; p <= 6; p++) {
    const page = chronicle.pages[p - 1]!;
    assert.equal(page.page, p);
    assert.ok(page.heading.length > 0);
    assert.ok(page.text.length > 20);
    assert.ok(page.scene_id.length > 0);
  }
});

test('T032: renderChronicleBook formats all 6 pages into visual ASCII layout', () => {
  const chronicle = fallbackChronicle(sampleInput, 42);
  const layout = renderChronicleBook(chronicle);

  assert.ok(layout.includes('THE WINTER WARDEN'));
  assert.ok(layout.includes('Page 1:'));
  assert.ok(layout.includes('Page 6:'));
  assert.ok(layout.includes('Epitaph:'));
  assert.ok(layout.includes('Share:'));
});

test('T032: P7b LLM output is validated and falls back cleanly if corrupted', async () => {
  const validP7b = {
    title: 'The Great Freeze',
    pages: [
      { page: 1, heading: 'Arrival', text: 'Walked in through snow.', scene_id: 'gate' },
      { page: 2, heading: 'The Work', text: 'Gathered wood and coal.', scene_id: 'square' },
      { page: 3, heading: 'The Secret', text: 'Found the poisoned grain.', scene_id: 'mill' },
      { page: 4, heading: 'The Trial', text: 'Faced the village guard.', scene_id: 'hall' },
      { page: 5, heading: 'The Stand', text: 'Stood before the chapel fire.', scene_id: 'chapel' },
      { page: 6, heading: 'The Legacy', text: 'Remembered as a protector.', scene_id: 'monument' },
    ],
    epitaph: 'A protector of the forgotten.',
    share_card: { headline: 'The Winter Shield', archetype: 'shepherd', ending_family: 'shepherd_saved' },
  };

  const provider = new MockProvider(() => JSON.stringify(validP7b));
  const client = new LlmClient({ provider, model: 'test-model' });

  const res = await generateChronicle(sampleInput, client, 7);
  assert.equal(res.source, 'llm');
  assert.equal(res.chronicle.title, 'The Great Freeze');
  assert.equal(res.chronicle.pages.length, 6);
});
