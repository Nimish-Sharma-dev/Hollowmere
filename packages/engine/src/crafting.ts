import type { ContentBundle, Id } from '../../shared/src/index.ts';
import { addItem, cloneInventory, count, removeItem } from './inventory.ts';
import type { Stack } from './inventory.ts';
import { clamp } from './stats.ts';
import { fail } from './state.ts';
import type { GameState, Result } from './state.ts';

export function canAfford(state: GameState, cost: { item: Id; qty: number }[]): boolean {
  return cost.every((c) => count(state.player.inventory, c.item) >= c.qty);
}

/** Craft one batch. Does not advance time (see actions.perform). Atomic. */
export function craftRecipe(state: GameState, content: ContentBundle, recipeId: Id): Result<{ output: Stack; ticks: number }> {
  if (!state.player.alive) return fail('player_dead');
  const r = content.recipes[recipeId];
  if (!r) return fail('unknown_recipe');
  if (r.station && !state.player.nearby.includes(r.station)) return fail('missing_station');
  if (!canAfford(state, r.inputs)) return fail('missing_ingredients');
  const outDef = content.items[r.output.item];
  if (!outDef) return fail('unknown_item');

  const inv = cloneInventory(state.player.inventory);
  for (const i of r.inputs) removeItem(inv, i.item, i.qty);
  const added = addItem(inv, outDef, r.output.qty);
  if (added < r.output.qty) return fail('inventory_full');

  state.player.inventory = inv;
  return { ok: true, output: { item: r.output.item, qty: r.output.qty }, ticks: r.ticks };
}

/** Build a structure at the player's base; it makes its station tag available. */
export function buildStructure(state: GameState, content: ContentBundle, structureId: Id): Result<{ kind: Id }> {
  if (!state.player.alive) return fail('player_dead');
  const def = content.structures[structureId];
  if (!def) return fail('unknown_structure');
  if (!canAfford(state, def.cost)) return fail('missing_ingredients');
  for (const c of def.cost) removeItem(state.player.inventory, c.item, c.qty);
  state.structures.push({ id: `${structureId}_${state.structures.length + 1}`, kind: structureId });
  if (!state.player.nearby.includes(def.provides)) state.player.nearby.push(def.provides);
  return { ok: true, kind: structureId };
}

/** Eat / use a consumable. Consumes one. */
export function useItem(state: GameState, content: ContentBundle, itemId: Id): Result<object> {
  if (!state.player.alive) return fail('player_dead');
  const def = content.items[itemId];
  if (!def) return fail('unknown_item');
  if (count(state.player.inventory, itemId) < 1) return fail('not_in_inventory');
  const st = state.player.stats;
  if (def.food) {
    st.hunger = clamp(st.hunger + def.food.hunger, 0, 100);
    st.health = clamp(st.health + (def.food.health ?? 0), 0, 100);
  } else if (def.remedy) {
    st.health = clamp(st.health + def.remedy.heal, 0, 100);
  } else {
    return fail('not_usable');
  }
  removeItem(state.player.inventory, itemId, 1);
  return { ok: true };
}

export function equipItem(state: GameState, content: ContentBundle, itemId: Id): Result<object> {
  if (!state.player.alive) return fail('player_dead');
  const def = content.items[itemId];
  if (!def) return fail('unknown_item');
  if (count(state.player.inventory, itemId) < 1) return fail('not_in_inventory');
  if (def.kind === 'weapon') state.player.equipped.weapon = itemId;
  else if (def.kind === 'clothing') state.player.equipped.clothing = itemId;
  else return fail('not_equippable');
  return { ok: true };
}
