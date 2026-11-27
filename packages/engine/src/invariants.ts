import { NEEDS, VILLAGE_STATS } from '../../shared/src/index.ts';
import type { ContentBundle } from '../../shared/src/index.ts';
import { CONFIG } from './config.ts';
import type { GameState } from './state.ts';

/** Cheap structural checks that must hold after every tick. Returns problems (empty = healthy). */
export function checkInvariants(state: GameState, content: ContentBundle): string[] {
  const out: string[] = [];
  for (const n of NEEDS) {
    const v = state.player.stats[n];
    if (!Number.isFinite(v) || v < 0 || v > 100) out.push(`stat ${n}=${v}`);
  }
  for (const v of VILLAGE_STATS) {
    const x = state.village[v];
    if (!Number.isFinite(x) || x < CONFIG.village.min || x > CONFIG.village.max) out.push(`village ${v}=${x}`);
  }
  const inv = state.player.inventory;
  if (inv.stacks.length > inv.slots) out.push('inventory over slot capacity');
  for (const s of inv.stacks) {
    const def = content.items[s.item];
    if (!def) out.push(`unknown item ${s.item}`);
    else if (!Number.isInteger(s.qty) || s.qty < 1 || s.qty > def.stack) out.push(`stack ${s.item} qty=${s.qty}`);
  }
  for (const [id, n] of Object.entries(state.npcs)) {
    if (!Number.isFinite(n.trust) || n.trust < CONFIG.npc.trustMin || n.trust > CONFIG.npc.trustMax) out.push(`trust ${id}=${n.trust}`);
  }
  for (const [id, n] of Object.entries(state.nodes)) {
    if (n.usesLeft < 0) out.push(`node ${id} usesLeft<0`);
  }
  if (!state.player.alive && state.player.stats.health > 0) out.push('dead with health>0');
  return out;
}
