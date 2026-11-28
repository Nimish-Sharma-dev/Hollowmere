// Usage: node packages/director/scripts/bibles.ts [count=10] [firstSeed=1]
// Prints readable Run Bible summaries so a human can judge "do these feel like different games?" (checkpoint 4).
import { join } from 'node:path';
import { loadContent } from '../../content/src/loader.ts';
import { buildFallbackBible, makeLore } from '../src/index.ts';
import type { RecentRun } from '../src/index.ts';

const count = Number(process.argv[2] ?? 10);
const first = Number(process.argv[3] ?? 1);
const content = loadContent(join(import.meta.dirname, '..', '..', 'content', 'data'));
const lore = makeLore();
const recents: RecentRun[] = [];
for (let i = 0; i < count; i++) {
  const r = buildFallbackBible(content, lore, { seed: first + i, recents });
  const b = r.bible;
  const name = (id: string): string => content.npcs[id]!.name;
  const villain = b.cast_roles.find((c) => c.npc_id === b.fingerprint.antagonist_npc_id)!;
  console.log(`\n=== Run ${first + i}: ${lore.crises[b.crisis.crisis_id]!.name} (${b.fingerprint.tone.replace(/_/g, ' ')}, may end as ${b.fingerprint.ending_family.replace(/_/g, ' ').replace('tyrants peace', "tyrant's peace")}) ===`);
  console.log(`Villain: ${name(villain.npc_id)} as ${villain.role_id.replace(/_/g, ' ')}. ${villain.hidden_motive}.`);
  console.log(`Their secret: ${b.secrets.find((s) => s.holder_npc_id === villain.npc_id)!.truth}`);
  console.log(`Clues at: ${b.crisis.clues.map((c) => `${c.clue_id} (${c.location_id})`).join(', ')}`);
  console.log(`Twist: ${lore.twists[b.fingerprint.twist_id]!.name}`);
  console.log(`Cast: ${b.cast_roles.map((c) => `${name(c.npc_id)}=${c.role_id}(${c.initial_attitude >= 0 ? '+' : ''}${c.initial_attitude})`).join(', ')}`);
  console.log(`Opening: ${b.opening_narration}`);
  recents.push({ fingerprint: b.fingerprint, profileKey: r.profileKey });
}
