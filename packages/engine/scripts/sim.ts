// Usage: node packages/engine/scripts/sim.ts [seed] [days] [startSeason]
import { runHeadless } from '../src/sim.ts';
import { makeContent, SIM_NODES, SIM_START } from '../test/fixtures/content.ts';
import type { Season } from '../../shared/src/index.ts';

const seed = Number(process.argv[2] ?? 1);
const days = Number(process.argv[3] ?? 30);
const startSeason = (process.argv[4] ?? 'autumn') as Season;
const content = makeContent();
const r = runHeadless(content, { seed, days, startSeason, nodes: SIM_NODES, startItems: SIM_START, equipped: { clothing: 'wool_coat' } });
const s = r.state;
console.log(`seed=${seed} days=${days} start=${startSeason}`);
console.log(`final hash      ${r.finalHash}`);
console.log(`actions         ${r.actions} (${r.failedActions} failed/idle)`);
console.log(`player          ${s.player.alive ? 'alive' : 'dead on day ' + String(r.deathDay) + ' (' + String(s.player.deathCause) + ')'}`);
console.log(`stats           ${JSON.stringify(s.player.stats, (_k, v) => (typeof v === 'number' ? Math.round(v * 10) / 10 : v))}`);
console.log(`village         ${JSON.stringify(s.village)}`);
console.log(`structures      ${s.structures.map((x) => x.kind).join(', ') || '-'}`);
console.log(`events run      ${s.eventLog.map((e) => `d${e.day}:${e.eventId}`).join(' ') || '-'}`);
console.log(`violations      ${r.violations.length}`);
