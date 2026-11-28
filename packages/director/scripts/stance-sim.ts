// Usage: node packages/director/scripts/stance-sim.ts
// T029: Simulates 200 runs to verify stance quotas (mirror, challenge, wildcard) stay within 10% of targets.
import { join } from 'node:path';
import { loadContent } from '../../content/src/loader.ts';
import { makeLore } from '../src/lore.ts';
import { runDirectedGame } from '../src/runtime.ts';
import { STANCE_TARGET } from '../src/director.ts';
import type { Stance } from '../src/director.ts';

const content = loadContent(join(import.meta.dirname, '..', '..', 'content', 'data'));
const lore = makeLore();

console.log('--- Hollowmere Stance Quota & Distribution Simulation across 200 Runs (T029) ---');

const TOTAL_RUNS = 200;
const DAYS_PER_RUN = 10;

const globalCounts: Record<Stance, number> = {
  mirror: 0,
  challenge: 0,
  wildcard: 0,
};

let totalDecisions = 0;

for (let r = 0; r < TOTAL_RUNS; r++) {
  const seed = 1000 + r;
  const res = await runDirectedGame(content, lore, { seed, days: DAYS_PER_RUN });

  for (const d of res.decisions) {
    if (d.stance && d.stance in globalCounts) {
      globalCounts[d.stance as Stance]++;
      totalDecisions++;
    }
  }
}

const mirrorRatio = globalCounts.mirror / totalDecisions;
const challengeRatio = globalCounts.challenge / totalDecisions;
const wildcardRatio = globalCounts.wildcard / totalDecisions;

console.log(`Total Decisions Measured across ${TOTAL_RUNS} runs: ${totalDecisions}`);
console.log(`- Mirror:    ${(mirrorRatio * 100).toFixed(1)}% (Target: ${(STANCE_TARGET.mirror * 100).toFixed(1)}% ±10%)`);
console.log(`- Challenge: ${(challengeRatio * 100).toFixed(1)}% (Target: ${(STANCE_TARGET.challenge * 100).toFixed(1)}% ±10%)`);
console.log(`- Wildcard:  ${(wildcardRatio * 100).toFixed(1)}% (Target: ${(STANCE_TARGET.wildcard * 100).toFixed(1)}% ±10%)`);

const TOLERANCE = 0.10;

const mirrorOk = Math.abs(mirrorRatio - STANCE_TARGET.mirror) <= TOLERANCE;
const challengeOk = Math.abs(challengeRatio - STANCE_TARGET.challenge) <= TOLERANCE;
const wildcardOk = Math.abs(wildcardRatio - STANCE_TARGET.wildcard) <= TOLERANCE;

if (mirrorOk && challengeOk && wildcardOk) {
  console.log('\nResult: STANCE MIX WITHIN 10% TARGET ACROSS 200 RUNS: PASSED');
} else {
  console.error('\nResult: STANCE MIX EXCEEDED 10% TOLERANCE');
  process.exit(1);
}
