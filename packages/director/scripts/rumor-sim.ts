// Usage: node packages/director/scripts/rumor-sim.ts
// T028: Simulates rumor generation, propagation, and mutation across in-game days.
import { join } from 'node:path';
import { loadContent } from '../../content/src/loader.ts';
import { makeLore } from '../src/lore.ts';
import { buildFallbackBible } from '../src/bible.ts';
import { startGameFromBible } from '../src/runtime.ts';
import {
  newVillageMemoryStore,
  processEventMemories,
  advanceRumorsDaily,
} from '../src/memory.ts';

const content = loadContent(join(import.meta.dirname, '..', '..', 'content', 'data'));
const lore = makeLore();
const { bible } = buildFallbackBible(content, lore, { seed: 101 });
const state = startGameFromBible(content, lore, bible, 101);
const store = newVillageMemoryStore();

console.log('--- Hollowmere P5 Memory & Rumor Mutation Simulation (T028) ---');

// Day 1: A significant event witnessed by Pip and Tobin
const eventText = 'The player broke open the sealed storage cellar in the old mill.';
const witnesses = ['pip', 'tobin'];

console.log(`[Day 1 Event]: "${eventText}" witnessed by ${witnesses.join(', ')}`);

const day1Result = await processEventMemories(
  eventText,
  witnesses,
  state,
  content,
  store,
  1,
  10,
  101,
  null // fallback / rule-based mode
);

const initialRumor = store.activeRumors[0];
if (!initialRumor) throw new Error('Failed to generate initial rumor');
console.log(`[Day 1 Rumor Generated (${initialRumor.mutation})]: "${initialRumor.text}"`);

const day1Text = initialRumor.text;

// Day 2: Advance day and observe mutation
advanceRumorsDaily(store, 102);
const day2Text = store.activeRumors[0]!.text;
console.log(`[Day 2 Mutated (Stage 2 - shrink)]: "${day2Text}"`);

if (day1Text === day2Text) {
  throw new Error('Rumor failed to mutate between Day 1 and Day 2');
}

// Day 3: Advance day and observe moral/spin mutation
advanceRumorsDaily(store, 103);
const day3Text = store.activeRumors[0]!.text;
console.log(`[Day 3 Mutated (Stage 3 - moral)]:  "${day3Text}"`);

if (day2Text === day3Text) {
  throw new Error('Rumor failed to mutate between Day 2 and Day 3');
}

// Verify Journal State
console.log('\n[Journal Relationships & Memory Status]:');
for (const [npcId, info] of Object.entries(store.journal.relationships)) {
  if (info.lastMemory) {
    console.log(` - ${npcId.padEnd(8)} Trust: ${String(info.trust).padStart(3)} | Memory: ${info.lastMemory}`);
  }
}

console.log(`\nJournal Rumors Recorded: ${store.journal.rumorsHeard.length}`);
console.log('Result: RUMOR MUTATION SIMULATION: PASSED (a rumor mutates across a sim)');
