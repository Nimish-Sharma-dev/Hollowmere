// Usage: node packages/director/scripts/sim.ts [runs=1000] [days=3]
// T019 check: many complete games with no LLM, validated Run Bibles, divergence gate.
import { loadContent } from '../../content/src/loader.ts';
import { join } from 'node:path';
import { Rng } from '../../engine/src/rng.ts';
import { makeLore, runDirectedGame, validateRunBible, divergenceGate, ARCHETYPES } from '../src/index.ts';
import type { OnboardingProfile, RecentRun, RunBible } from '../src/index.ts';

const runs = Number(process.argv[2] ?? 1000);
const days = Number(process.argv[3] ?? 3);
const content = loadContent(join(import.meta.dirname, '..', '..', 'content', 'data'));
const lore = makeLore();
const rng = new Rng(77);
const recents: RecentRun[] = [];
const bibles: RunBible[] = [];
const hashes = new Set<string>();
const crises: Record<string, number> = {};
const stance = { mirror: 0, challenge: 0, wildcard: 0 };
let invalid = 0;
let violations = 0;
let decisions = 0;
let none = 0;
const started = Date.now();

for (let i = 0; i < runs; i++) {
  const scores = Object.fromEntries(ARCHETYPES.map((a) => [a, Math.round(rng.next() * 100) / 100])) as OnboardingProfile['archetype_scores'];
  const profile: OnboardingProfile = { values: ['loyalty'], fears: ['cold'], archetype_scores: scores, core_motivation: rng.pick(['safety', 'power', 'freedom', 'home'] as const), backstory_seed: 'x', contradiction: null, story_hook: 'y', spawn_preference: { spawn_id: rng.pick(Object.keys(lore.spawns).sort()), reason: 'r' }, starting_kit_id: rng.pick(Object.keys(lore.kits).sort()) };
  const r = await runDirectedGame(content, lore, { seed: i + 1, days, profile, recents });
  if (!validateRunBible(r.bible, { content, lore, recents, profileKey: r.profileKey }).ok) invalid++;
  violations += r.violations.length;
  decisions += r.decisions.length;
  none += r.decisions.filter((d) => d.source === 'none').length;
  for (const k of ['mirror', 'challenge', 'wildcard'] as const) stance[k] += r.memory.stanceCounts[k];
  crises[r.bible.crisis.crisis_id] = (crises[r.bible.crisis.crisis_id] ?? 0) + 1;
  recents.push({ fingerprint: r.bible.fingerprint, profileKey: r.profileKey });
  bibles.push(r.bible);
  hashes.add(r.finalHash);
}
const gate = divergenceGate(bibles, 2000, new Rng(3));
console.log(`runs completed       ${runs} x ${days} days in ${((Date.now() - started) / 1000).toFixed(1)} s (no LLM)`);
console.log(`invalid bibles       ${invalid}`);
console.log(`invariant violations ${violations}`);
console.log(`distinct outcomes    ${hashes.size}`);
console.log(`crises used          ${JSON.stringify(crises)}`);
console.log(`decisions            ${decisions} (${none} with no eligible event: a content gap)`);
console.log(`stance mix           ${JSON.stringify(stance)}`);
console.log(`divergence gate      ${gate.pass ? 'PASS' : 'FAIL'} (mean ${gate.meanAverage}, same-game ${gate.samePct.toFixed(1)}%, axes ${JSON.stringify(gate.axisMeans)})`);
process.exit(invalid === 0 && violations === 0 && gate.pass ? 0 : 1);
