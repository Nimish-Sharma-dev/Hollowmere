import type { Id, ItemDef } from '../../shared/src/index.ts';

export interface Stack {
  item: Id;
  qty: number;
}

export interface Inventory {
  slots: number;
  stacks: Stack[];
}

export function newInventory(slots: number): Inventory {
  return { slots, stacks: [] };
}

export function count(inv: Inventory, item: Id): number {
  let n = 0;
  for (const s of inv.stacks) if (s.item === item) n += s.qty;
  return n;
}

/** how many more of this item would fit */
export function capacityFor(inv: Inventory, def: ItemDef): number {
  let room = 0;
  for (const s of inv.stacks) if (s.item === def.id) room += def.stack - s.qty;
  room += (inv.slots - inv.stacks.length) * def.stack;
  return room;
}

/** Adds as many as fit; returns the number actually added. */
export function addItem(inv: Inventory, def: ItemDef, qty: number): number {
  if (!Number.isInteger(qty) || qty < 0) throw new Error(`addItem: bad qty ${qty}`);
  let left = qty;
  for (const s of inv.stacks) {
    if (left === 0) break;
    if (s.item !== def.id) continue;
    const add = Math.min(left, def.stack - s.qty);
    s.qty += add;
    left -= add;
  }
  while (left > 0 && inv.stacks.length < inv.slots) {
    const add = Math.min(left, def.stack);
    inv.stacks.push({ item: def.id, qty: add });
    left -= add;
  }
  return qty - left;
}

/** Removes exactly qty or nothing. Takes from the last stacks first. */
export function removeItem(inv: Inventory, item: Id, qty: number): boolean {
  if (!Number.isInteger(qty) || qty < 0) throw new Error(`removeItem: bad qty ${qty}`);
  if (count(inv, item) < qty) return false;
  let left = qty;
  for (let i = inv.stacks.length - 1; i >= 0 && left > 0; i--) {
    const s = inv.stacks[i]!;
    if (s.item !== item) continue;
    const take = Math.min(left, s.qty);
    s.qty -= take;
    left -= take;
  }
  inv.stacks = inv.stacks.filter((s) => s.qty > 0);
  return true;
}

export function cloneInventory(inv: Inventory): Inventory {
  return { slots: inv.slots, stacks: inv.stacks.map((s) => ({ ...s })) };
}
