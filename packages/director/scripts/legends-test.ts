// Usage: node packages/director/scripts/legends-test.ts
// T031: Verifies that a Ghost Legend written at the end of Run A appears as a monument in Run B.
import {
  generateGhostLegend,
  placeGhostMonuments,
} from '../src/legends.ts';
import type { GhostLegend, RunSummary } from '../src/legends.ts';
import { bareState } from '../test/fixtures.ts';

console.log('--- Hollowmere Ghost Legends & Monuments Test (T031) ---');

// 1. Run A ends: generate a ghost legend
const runSummaryA: RunSummary = {
  runId: 'run_A_778899',
  archetype: 'shepherd',
  endingFamily: 'shepherd_saved',
  deeds: ['Shared winter firewood with Pip', 'Exposed the hoarder in the granary', 'Fed the chapel orphans'],
  savedNpcIds: ['pip', 'edda', 'tobin'],
  abandonedNpcIds: ['alder'],
  daysSurvived: 14,
};

console.log('[Run A Ending]: Writing ghost legend for run:', runSummaryA.runId);
const resA = await generateGhostLegend(runSummaryA, null, 777);
const legendA = resA.legend;

console.log(`[Run A Legend Created (${legendA.monumentType})]:\n"${legendA.legendText}"`);

// 2. Shared database pool receives Run A's legend
const sharedLegendsDb: GhostLegend[] = [legendA];

// 3. Run B starts: loads historical legends from the shared pool
console.log('\n[Run B Starting]: Initializing new game world...');
const stateB = bareState(999);

const placedInB = placeGhostMonuments(stateB, sharedLegendsDb, 2, 999);

console.log(`Placed ${placedInB.length} monuments in Run B:`);
for (const p of placedInB) {
  console.log(` - Structure ID: ${p.monumentId} (${p.monumentType}) at ${p.location}`);
  console.log(`   Text: "${p.legendText}"`);
}

// Check: a legend from run A appears in run B
const foundLegendAInB = placedInB.some((p) => p.legendId === legendA.id);
const foundStructureInB = stateB.structures.some((s) => s.id === `monument_${legendA.id}`);

if (foundLegendAInB && foundStructureInB) {
  console.log('\nResult: A LEGEND FROM RUN A APPEARS IN RUN B: PASSED');
} else {
  console.error('\nResult: FAILED - Legend from Run A not found in Run B');
  process.exit(1);
}
