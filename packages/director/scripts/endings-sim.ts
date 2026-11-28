// Usage: node packages/director/scripts/endings-sim.ts
// T033: Simulates runs to verify every ending family and title reveal is reachable in a sim.
import { join } from 'node:path';
import { loadContent } from '../../content/src/loader.ts';
import { Rng } from '../../engine/src/rng.ts';
import { makeLore, ENDINGS } from '../src/lore.ts';
import { ARCHETYPES } from '../src/schemas.ts';
import { buildFallbackBible } from '../src/bible.ts';
import { evaluateEnding, generateTitleReveal, dominantArchetype } from '../src/endings.ts';
import type { EndingFamily, EndingEvaluationInput } from '../src/endings.ts';
import type { Archetype } from '../src/bible.ts';

const content = loadContent(join(import.meta.dirname, '..', '..', 'content', 'data'));
const lore = makeLore();
const rng = new Rng(42);

console.log('--- Hollowmere Endings & Title Reveal Simulation (T033) ---');

const TOTAL_RUNS = 300;
const endingCounts: Record<EndingFamily, number> = Object.fromEntries(
  ENDINGS.map((e) => [e, 0])
) as Record<EndingFamily, number>;

const archetypeCounts: Record<Archetype, number> = Object.fromEntries(
  ARCHETYPES.map((a) => [a, 0])
) as Record<Archetype, number>;

const sampleReveals: Partial<Record<EndingFamily, { archetype: Archetype; title: string; epithet: string; reason: string }>> = {};

// We simulate diverse playstyles and world conditions across runs
const PLAYSTYLES: {
  name: string;
  archetype: Archetype;
  statModifier: (v: Record<'hope' | 'fear' | 'hunger' | 'trust' | 'unity', number>) => void;
  flags?: { playerAlive?: boolean; villagersExpelled?: boolean; abandonedVillage?: boolean; crisisResolved?: boolean };
}[] = [
  {
    name: 'The Selfless Guardian',
    archetype: 'shepherd',
    statModifier: (v) => { v.hope = 8.5; v.trust = 8.0; v.unity = 7.5; v.fear = 2.0; v.hunger = 2.5; },
    flags: { playerAlive: true, crisisResolved: true },
  },
  {
    name: 'The Iron Autocrat',
    archetype: 'tyrant',
    statModifier: (v) => { v.fear = 8.0; v.unity = 6.5; v.trust = 2.0; v.hunger = 4.0; v.hope = 4.0; },
    flags: { playerAlive: true, crisisResolved: true },
  },
  {
    name: 'The Wandering Outcast',
    archetype: 'lone_wolf',
    statModifier: (v) => { v.trust = 1.5; v.fear = 5.0; v.hope = 3.5; v.unity = 2.0; },
    flags: { playerAlive: true, villagersExpelled: true },
  },
  {
    name: 'The Fallen Despair',
    archetype: 'scavenger',
    statModifier: (v) => { v.hope = 1.0; v.hunger = 9.0; v.fear = 8.5; v.trust = 2.0; },
    flags: { playerAlive: false, crisisResolved: false },
  },
  {
    name: 'The Quiet Peacemaker',
    archetype: 'peacemaker',
    statModifier: (v) => { v.trust = 7.5; v.fear = 2.5; v.hope = 6.0; v.unity = 7.0; v.hunger = 3.5; },
    flags: { playerAlive: true, crisisResolved: true },
  },
  {
    name: 'The Bitter Survivor',
    archetype: 'trickster',
    statModifier: (v) => { v.hope = 4.5; v.fear = 5.5; v.hunger = 5.0; v.trust = 4.5; v.unity = 4.0; },
    flags: { playerAlive: true, crisisResolved: true },
  },
];

for (let r = 0; r < TOTAL_RUNS; r++) {
  const seed = 5000 + r;
  const style = PLAYSTYLES[r % PLAYSTYLES.length]!;

  // Build a realistic fallback bible for the run
  const built = buildFallbackBible(content, lore, { seed });
  const bible = built.bible;

  // Base village stats from the crisis
  const village = {
    hope: 5 + (rng.next() - 0.5) * 2,
    fear: 3 + (rng.next() - 0.5) * 2,
    hunger: 3 + (rng.next() - 0.5) * 2,
    trust: 4 + (rng.next() - 0.5) * 2,
    unity: 5 + (rng.next() - 0.5) * 2,
  };

  // Apply playstyle adjustments with some stochastic variance
  style.statModifier(village);
  village.hope = Math.max(0, Math.min(10, village.hope + (rng.next() - 0.5) * 1.5));
  village.fear = Math.max(0, Math.min(10, village.fear + (rng.next() - 0.5) * 1.5));
  village.hunger = Math.max(0, Math.min(10, village.hunger + (rng.next() - 0.5) * 1.5));
  village.trust = Math.max(0, Math.min(10, village.trust + (rng.next() - 0.5) * 1.5));
  village.unity = Math.max(0, Math.min(10, village.unity + (rng.next() - 0.5) * 1.5));

  // Archetype scores leaning into the playstyle archetype with minor secondary scores
  const scores: Record<Archetype, number> = Object.fromEntries(
    ARCHETYPES.map((a) => [a, a === style.archetype ? 0.7 + rng.next() * 0.3 : rng.next() * 0.4])
  ) as Record<Archetype, number>;

  // NPCs alive simulation
  const npcs: Record<string, { alive: boolean; trust: number }> = {};
  const isDoomed = style.name === 'The Fallen Despair';
  for (const npcId of Object.keys(content.npcs)) {
    const alive = isDoomed ? rng.chance(0.25) : rng.chance(0.9);
    npcs[npcId] = { alive, trust: village.trust - 5 };
  }

  const evalInput: EndingEvaluationInput = {
    bible,
    state: {
      village,
      player: { alive: style.flags?.playerAlive ?? true },
      npcs,
      daysSurvived: 12,
      crisisResolved: style.flags?.crisisResolved ?? true,
      villagersExpelled: style.flags?.villagersExpelled ?? false,
      abandonedVillage: style.flags?.abandonedVillage ?? false,
    },
    archetypeScores: scores,
    definingDeeds: ['Brought dry wood from the ridge', 'Stood vigil at the gate'],
  };

  const res = evaluateEnding(evalInput);

  endingCounts[res.endingFamily]++;
  archetypeCounts[res.dominantArchetype]++;

  if (!sampleReveals[res.endingFamily]) {
    sampleReveals[res.endingFamily] = {
      archetype: res.dominantArchetype,
      title: res.titleReveal.title,
      epithet: res.titleReveal.epithet,
      reason: res.titleReveal.reason,
    };
  }
}

console.log(`\nSimulated ${TOTAL_RUNS} runs across all archetypes and crisis conditions:\n`);
console.log('ENDING FAMILIES REACHED:');
for (const e of ENDINGS) {
  const count = endingCounts[e];
  const pct = ((count / TOTAL_RUNS) * 100).toFixed(1);
  console.log(`  - ${e.padEnd(18)}: ${count.toString().padStart(3)} runs (${pct}%)`);
}

console.log('\nDOMINANT ARCHETYPES DETECTED:');
for (const a of ARCHETYPES) {
  const count = archetypeCounts[a];
  const pct = ((count / TOTAL_RUNS) * 100).toFixed(1);
  console.log(`  - ${a.padEnd(14)}: ${count.toString().padStart(3)} runs (${pct}%)`);
}

console.log('\nSAMPLE TITLE REVEALS BY ENDING FAMILY:');
for (const e of ENDINGS) {
  const s = sampleReveals[e];
  if (s) {
    console.log(`\n[${e.toUpperCase()}] -> Dominant: ${s.archetype}`);
    console.log(`  Title   : "${s.title}" (${s.epithet})`);
    console.log(`  Reason  : "${s.reason}"`);
  }
}

// Verification: Every ending family MUST be reached at least once
const missingEndings = ENDINGS.filter((e) => endingCounts[e] === 0);
if (missingEndings.length > 0) {
  console.error(`\nFAIL: Missing reachable ending families: ${missingEndings.join(', ')}`);
  process.exit(1);
}

console.log('\nSUCCESS: Every ending family and title reveal is reachable in simulation!');
