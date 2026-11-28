import type { ContentBundle, Id } from '../../shared/src/index.ts';
import { addItem, cloneInventory } from './inventory.ts';
import type { Stack } from './inventory.ts';
import { clamp } from './stats.ts';
import { currentDay, fail, withRng } from './state.ts';
import type { GameState, Result } from './state.ts';

/** best power among inventory tools of the given type, or 0 if none */
export function bestToolPower(state: GameState, content: ContentBundle, type: string): number {
  let best = 0;
  for (const s of state.player.inventory.stacks) {
    const t = content.items[s.item]?.tool;
    if (t && t.type === type && t.power > best) best = t.power;
  }
  return best;
}

/**
 * Gather once from a node instance. Does not advance time (see actions.perform).
 * Atomic: if nothing fits in the inventory, nothing is consumed.
 */
export function gatherNode(state: GameState, content: ContentBundle, nodeId: Id): Result<{ gained: Stack[]; dropped: Stack[] }> {
  if (!state.player.alive) return fail('player_dead');
  const node = state.nodes[nodeId];
  if (!node) return fail('unknown_node');
  const def = content.nodes[node.def];
  if (!def) return fail('unknown_node_def');
  if (node.usesLeft <= 0) return fail('depleted');

  let power = 0;
  if (def.tool) {
    power = bestToolPower(state, content, def.tool);
    if (power <= 0) return fail('missing_tool');
  }
  const bonus = def.tool ? Math.max(0, Math.floor(power) - 1) : 0;

  const rolled: Stack[] = withRng(state, (rng) => {
    const out: Stack[] = [];
    for (const y of def.yields) {
      if (y.chance !== undefined && !rng.chance(y.chance)) continue;
      const qty = rng.int(y.min, y.max) + bonus;
      if (qty > 0) out.push({ item: y.item, qty });
    }
    return out;
  });

  const inv = cloneInventory(state.player.inventory);
  const gained: Stack[] = [];
  const dropped: Stack[] = [];
  let totalAdded = 0;
  for (const r of rolled) {
    const idef = content.items[r.item];
    if (!idef) return fail('unknown_item');
    const added = addItem(inv, idef, r.qty);
    totalAdded += added;
    if (added > 0) gained.push({ item: r.item, qty: added });
    if (added < r.qty) dropped.push({ item: r.item, qty: r.qty - added });
  }
  if (rolled.length > 0 && totalAdded === 0) return fail('inventory_full');

  state.player.inventory = inv;
  node.usesLeft -= 1;
  if (node.usesLeft === 0) node.respawnDay = currentDay(state) + def.respawnDays;
  const cost = def.energyCost ?? 2;
  state.player.stats.energy = clamp(state.player.stats.energy - cost, 0, 100);
  return { ok: true, gained, dropped };
}

/** Refill nodes whose respawn day has arrived. Called at day rollover. */
export function refreshNodes(state: GameState, content: ContentBundle): void {
  const day = currentDay(state);
  for (const id of Object.keys(state.nodes).sort()) {
    const n = state.nodes[id]!;
    if (n.usesLeft === 0 && n.respawnDay !== null && day >= n.respawnDay) {
      n.usesLeft = content.nodes[n.def]?.uses ?? 0;
      n.respawnDay = null;
    }
  }
}

