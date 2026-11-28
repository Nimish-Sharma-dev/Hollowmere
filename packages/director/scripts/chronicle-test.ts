// Usage: node packages/director/scripts/chronicle-test.ts
// T032: Verifies that the Chronicle viewer and export layout successfully renders for 5 fixture runs.
import {
  generateChronicle,
  renderChronicleBook,
} from '../src/chronicle.ts';
import type { ChronicleInput } from '../src/chronicle.ts';

console.log('--- Hollowmere Chronicle Storybook Generator Test (T032) ---');

const FIXTURE_RUNS: ChronicleInput[] = [
  {
    runId: 'fixture_run_1',
    playerTitle: 'The Winter Shepherd',
    archetype: 'shepherd',
    endingFamily: 'shepherd_saved',
    keyBeats: [
      { day: 1, location: 'gate', npcs: ['voss'], eventId: 'arrival' },
      { day: 3, location: 'square', npcs: ['edda', 'pip'], eventId: 'bread_gift' },
      { day: 6, location: 'chapel', npcs: ['edda'], eventId: 'soup_kitchen' },
      { day: 8, location: 'granary', npcs: ['alder'], eventId: 'confront_hoarder' },
      { day: 11, location: 'mill', npcs: ['tobin'], eventId: 'secret_revealed' },
      { day: 14, location: 'square', npcs: ['all'], eventId: 'winter_survived' },
    ],
    villagerQuotes: [
      { npcId: 'pip', quote: 'They gave me their bread when everyone else slammed their shutters.' },
      { npcId: 'maren', quote: 'A soft heart. In this village, that usually gets you killed.' },
    ],
    unfoundSecret: 'The miller buried stolen silver under the stone hearth.',
  },
  {
    runId: 'fixture_run_2',
    playerTitle: 'The Hermit of the Ridge',
    archetype: 'lone_wolf',
    endingFamily: 'scarred_survival',
    keyBeats: [
      { day: 1, location: 'forest', npcs: [], eventId: 'woods_arrival' },
      { day: 4, location: 'ridge', npcs: ['wren'], eventId: 'wolf_hunt' },
      { day: 7, location: 'forge', npcs: ['maren'], eventId: 'barter_iron' },
      { day: 9, location: 'ridge', npcs: [], eventId: 'frost_solitude' },
      { day: 12, location: 'camp', npcs: [], eventId: 'lone_shelter' },
      { day: 15, location: 'wilds', npcs: [], eventId: 'escape_alone' },
    ],
    villagerQuotes: [
      { npcId: 'wren', quote: 'They lived on frozen meat and silence. I respected that.' },
      { npcId: 'alder', quote: 'An outcast who never lifted a finger for our village.' },
    ],
    unfoundSecret: 'The ruined tower hid an ancient heating pipe system.',
  },
  {
    runId: 'fixture_run_3',
    playerTitle: "The Blacksmith's Betrayer",
    archetype: 'tyrant',
    endingFamily: 'exile',
    keyBeats: [
      { day: 1, location: 'gate', npcs: ['voss'], eventId: 'forced_entry' },
      { day: 3, location: 'forge', npcs: ['maren'], eventId: 'demanded_tools' },
      { day: 6, location: 'store', npcs: ['bram'], eventId: 'extorted_food' },
      { day: 9, location: 'hall', npcs: ['alder'], eventId: 'usurped_council' },
      { day: 11, location: 'square', npcs: ['voss'], eventId: 'guard_clash' },
      { day: 13, location: 'gate', npcs: ['all'], eventId: 'driven_out' },
    ],
    villagerQuotes: [
      { npcId: 'maren', quote: 'They took my grandfather hammer and laughed in my face.' },
      { npcId: 'voss', quote: 'A tyrant in the making. We cast them out before blood was spilled.' },
    ],
    unfoundSecret: 'Maren had forged weapons for the winter raiders.',
  },
  {
    runId: 'fixture_run_4',
    playerTitle: 'The Peacemaker of the Mill',
    archetype: 'peacemaker',
    endingFamily: 'peace_restored',
    keyBeats: [
      { day: 1, location: 'gate', npcs: ['tobin'], eventId: 'gentle_arrival' },
      { day: 3, location: 'mill', npcs: ['tobin', 'alder'], eventId: 'settled_debt' },
      { day: 5, location: 'chapel', npcs: ['edda', 'voss'], eventId: 'halted_accusation' },
      { day: 8, location: 'square', npcs: ['all'], eventId: 'village_assembly' },
      { day: 10, location: 'forge', npcs: ['maren', 'pip'], eventId: 'reconciled_family' },
      { day: 14, location: 'hall', npcs: ['all'], eventId: 'unity_pact' },
    ],
    villagerQuotes: [
      { npcId: 'tobin', quote: 'Without them, the forge and mill would have burned each other down.' },
      { npcId: 'alder', quote: 'They spoke quietly, but everyone listened.' },
    ],
    unfoundSecret: 'The old chapel held documents proving the mayor had no legal claim.',
  },
  {
    runId: 'fixture_run_5',
    playerTitle: 'The Shadow Peddler',
    archetype: 'trickster',
    endingFamily: 'village_falls',
    keyBeats: [
      { day: 1, location: 'square', npcs: ['bram'], eventId: 'swindled_trader' },
      { day: 4, location: 'hall', npcs: ['pip'], eventId: 'stole_keys' },
      { day: 7, location: 'mill', npcs: ['tobin'], eventId: 'spread_false_rumor' },
      { day: 9, location: 'chapel', npcs: ['edda'], eventId: 'plundered_relics' },
      { day: 11, location: 'square', npcs: ['all'], eventId: 'riot_incited' },
      { day: 13, location: 'ruins', npcs: [], eventId: 'escaped_with_loot' },
    ],
    villagerQuotes: [
      { npcId: 'edda', quote: 'A serpent wrapped in a winter cloak.' },
      { npcId: 'pip', quote: 'They showed me how to pick locks, then disappeared with the bread.' },
    ],
    unfoundSecret: 'The chapel altar had a false bottom concealing cult robes.',
  },
];

console.log(`Generating and rendering Chronicles for ${FIXTURE_RUNS.length} fixture runs...\n`);

for (let i = 0; i < FIXTURE_RUNS.length; i++) {
  const fixture = FIXTURE_RUNS[i]!;
  const res = await generateChronicle(fixture, null, 100 + i);
  const chronicle = res.chronicle;

  if (chronicle.pages.length !== 6) {
    throw new Error(`Chronicle for ${fixture.runId} has ${chronicle.pages.length} pages, expected exactly 6!`);
  }

  for (const page of chronicle.pages) {
    if (!page.heading || !page.text || !page.scene_id) {
      throw new Error(`Invalid page structure in ${fixture.runId} on page ${page.page}`);
    }
  }

  const renderedBook = renderChronicleBook(chronicle);
  if (!renderedBook.includes('Page 1:') || !renderedBook.includes('Page 6:') || !renderedBook.includes('Epitaph:')) {
    throw new Error(`Rendered layout missing essential fields in ${fixture.runId}`);
  }

  console.log(`--- [Run ${i + 1}/${FIXTURE_RUNS.length} Rendered]: "${chronicle.title}" ---`);
  console.log(`Pages: 6 | Headline: "${chronicle.shareCard.headline}" | Scene 1: ${chronicle.pages[0]!.scene_id}`);
}

console.log('\nSample Rendered Chronicle (Run 1):\n');
const sampleRes = await generateChronicle(FIXTURE_RUNS[0]!, null, 100);
console.log(renderChronicleBook(sampleRes.chronicle));

console.log('\nResult: A CHRONICLE RENDERS FOR 5 FIXTURE RUNS: PASSED');
