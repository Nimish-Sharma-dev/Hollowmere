import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addItem, count, removeItem, newInventory, capacityFor, perform, gatherNode, craftRecipe, buildStructure, useItem, equipItem, currentDay, advance, checkInvariants } from '../src/index.ts';
import { makeContent } from './fixtures/content.ts';
import { newGame, dayStart } from './helpers.ts';

/* ───────────── inventory ───────────── */

test('inventory stacks, respects stack size and slot count', () => {
  const c = makeContent();
  const inv = newInventory(3);
  assert.equal(addItem(inv, c.items['wood']!, 25), 25); // 20 + 5
  assert.deepEqual(inv.stacks, [{ item: 'wood', qty: 20 }, { item: 'wood', qty: 5 }]);
  assert.equal(addItem(inv, c.items['wood']!, 10), 10); // tops up the second stack
  assert.deepEqual(inv.stacks, [{ item: 'wood', qty: 20 }, { item: 'wood', qty: 15 }]);
  assert.equal(addItem(inv, c.items['wood']!, 30), 25); // 5 more in stack two + a full third stack; 5 do not fit
  assert.equal(count(inv, 'wood'), 60);
  assert.equal(addItem(inv, c.items['stone']!, 1), 0); // no free slot
  assert.equal(capacityFor(inv, c.items['wood']!), 0);
});

test('removeItem is all-or-nothing and spans stacks', () => {
  const c = makeContent();
  const inv = newInventory(5);
  addItem(inv, c.items['wood']!, 30);
  assert.equal(removeItem(inv, 'wood', 31), false);
  assert.equal(count(inv, 'wood'), 30);
  assert.equal(removeItem(inv, 'wood', 25), true);
  assert.equal(count(inv, 'wood'), 5);
  assert.equal(inv.stacks.length, 1);
  assert.throws(() => addItem(inv, c.items['wood']!, -1));
});

/* ───────────── gathering ───────────── */

test('gathering needs the right tool and yields within range (+ tool bonus)', () => {
  const noTool = newGame({ startItems: [] });
  assert.deepEqual(gatherNode(noTool.state, noTool.content, 'oak_01'), { ok: false, reason: 'missing_tool' });

  const { state, content } = newGame();
  const seen = new Set<number>();
  for (let i = 0; i < 300; i++) {
    state.nodes['oak_01']!.usesLeft = 3;
    state.player.inventory.stacks = state.player.inventory.stacks.filter((s) => s.item !== 'wood');
    const r = gatherNode(state, content, 'oak_01');
    assert.ok(r.ok);
    if (r.ok) seen.add(r.gained[0]!.qty);
  }
  // wood 2..4, axe power 2 => +1 => 3..5
  assert.deepEqual([...seen].sort(), [3, 4, 5]);
});

test('nodes deplete, then respawn after their respawn days', () => {
  const { state, content } = newGame();
  for (let i = 0; i < 3; i++) assert.ok(gatherNode(state, content, 'oak_01').ok);
  assert.deepEqual(gatherNode(state, content, 'oak_01'), { ok: false, reason: 'depleted' });
  assert.equal(state.nodes['oak_01']!.respawnDay, 3); // day 1 + 2

  advance(state, content, dayStart(2) - state.tick, 'idle'); // reach day 2
  assert.equal(currentDay(state), 2);
  assert.equal(state.nodes['oak_01']!.usesLeft, 0);
  advance(state, content, 240, 'idle'); // reach day 3
  assert.equal(currentDay(state), 3);
  assert.equal(state.nodes['oak_01']!.usesLeft, 3);
  assert.equal(state.nodes['oak_01']!.respawnDay, null);
});

test('gathering is atomic when the inventory is full', () => {
  const { state, content } = newGame({ startItems: [{ item: 'stone', qty: 20 }] });
  state.player.inventory.slots = 1;
  const before = JSON.stringify(state.player);
  const rngBefore = state.rng;
  const r = gatherNode(state, content, 'bush_01');
  assert.deepEqual(r, { ok: false, reason: 'inventory_full' });
  assert.equal(state.nodes['bush_01']!.usesLeft, 4);
  assert.equal(JSON.stringify(state.player), before);
  assert.notEqual(state.rng, rngBefore); // the roll happened, deterministically
});

test('a partially fitting gather keeps what fits and reports what was dropped', () => {
  const { state, content } = newGame({ startItems: [{ item: 'berries', qty: 19 }] });
  state.player.inventory.slots = 1;
  const r = gatherNode(state, content, 'bush_01');
  assert.ok(r.ok);
  if (r.ok) {
    assert.deepEqual(r.gained, [{ item: 'berries', qty: 1 }]);
    assert.ok(r.dropped[0]!.qty >= 1);
  }
  assert.equal(count(state.player.inventory, 'berries'), 20);
});

test('perform(gather) spends time and energy; unknown nodes fail without costing time', () => {
  const { state, content } = newGame();
  const e0 = state.player.stats.energy;
  const r = perform(state, content, { type: 'gather', node: 'oak_01' });
  assert.deepEqual(r, { ok: true, ticks: 2 });
  assert.equal(state.tick, 2);
  assert.ok(state.player.stats.energy < e0 - 2); // -2 gather cost, minus tick decay
  const bad = perform(state, content, { type: 'gather', node: 'nope' });
  assert.deepEqual(bad, { ok: false, reason: 'unknown_node' });
  assert.equal(state.tick, 2);
});

/* ───────────── crafting, building, items ───────────── */

test('crafting needs ingredients and the right station, and is data-driven', () => {
  const { state, content } = newGame({ startItems: [{ item: 'raw_meat', qty: 2 }] });
  assert.deepEqual(craftRecipe(state, content, 'cooked_meat'), { ok: false, reason: 'missing_station' });
  state.player.nearby = ['fire'];
  assert.deepEqual(craftRecipe(state, content, 'nope'), { ok: false, reason: 'unknown_recipe' });
  const r = craftRecipe(state, content, 'cooked_meat');
  assert.ok(r.ok);
  assert.equal(count(state.player.inventory, 'raw_meat'), 1);
  assert.equal(count(state.player.inventory, 'cooked_meat'), 1);
  craftRecipe(state, content, 'cooked_meat');
  assert.deepEqual(craftRecipe(state, content, 'cooked_meat'), { ok: false, reason: 'missing_ingredients' });
});

test('stationless recipes work anywhere and perform() charges the recipe time', () => {
  const { state, content } = newGame({ startItems: [{ item: 'wood', qty: 2 }, { item: 'stone', qty: 2 }] });
  const r = perform(state, content, { type: 'craft', recipe: 'axe' });
  assert.deepEqual(r, { ok: true, ticks: 3 });
  assert.equal(state.tick, 3);
  assert.equal(count(state.player.inventory, 'axe'), 1);
});

test('crafting is atomic when the result does not fit', () => {
  const { state, content } = newGame({ startItems: [{ item: 'raw_meat', qty: 2 }] });
  state.player.nearby = ['fire'];
  // two slots: raw meat and a full stack of cooked meat. The output cannot fit anywhere.
  state.player.inventory.stacks = [{ item: 'raw_meat', qty: 2 }, { item: 'cooked_meat', qty: 10 }];
  state.player.inventory.slots = 2;
  const snap = JSON.stringify(state.player.inventory);
  assert.deepEqual(craftRecipe(state, content, 'cooked_meat'), { ok: false, reason: 'inventory_full' });
  assert.equal(JSON.stringify(state.player.inventory), snap);
});

test('crafting may reuse a slot freed by its own inputs', () => {
  const { state, content } = newGame({ startItems: [] });
  state.player.nearby = ['fire'];
  state.player.inventory.stacks = [{ item: 'raw_meat', qty: 1 }, { item: 'cooked_meat', qty: 10 }];
  state.player.inventory.slots = 2;
  assert.ok(craftRecipe(state, content, 'cooked_meat').ok);
  assert.equal(count(state.player.inventory, 'cooked_meat'), 11);
});

test('building consumes the cost and makes the station available', () => {
  const { state, content } = newGame({ startItems: [{ item: 'wood', qty: 5 }, { item: 'stone', qty: 2 }] });
  assert.deepEqual(buildStructure(state, content, 'shelter'), { ok: false, reason: 'missing_ingredients' });
  assert.deepEqual(buildStructure(state, content, 'campfire'), { ok: true, kind: 'campfire' });
  assert.equal(count(state.player.inventory, 'wood'), 0);
  assert.deepEqual(state.player.nearby, ['fire']);
  assert.equal(state.structures.length, 1);
  assert.deepEqual(buildStructure(state, content, 'nope'), { ok: false, reason: 'unknown_structure' });
});

test('eating, healing and equipping', () => {
  const { state, content } = newGame({ startItems: [{ item: 'cooked_meat', qty: 2 }, { item: 'bandage', qty: 1 }, { item: 'fur_cloak', qty: 1 }, { item: 'sword', qty: 1 }, { item: 'wood', qty: 1 }] });
  state.player.stats.hunger = 90;
  state.player.stats.health = 50;
  assert.ok(useItem(state, content, 'cooked_meat').ok);
  assert.equal(state.player.stats.hunger, 100); // clamped (90 + 28)
  assert.equal(state.player.stats.health, 52);
  assert.ok(useItem(state, content, 'bandage').ok);
  assert.equal(state.player.stats.health, 77);
  assert.deepEqual(useItem(state, content, 'wood'), { ok: false, reason: 'not_usable' });
  assert.deepEqual(useItem(state, content, 'bread'), { ok: false, reason: 'not_in_inventory' });
  assert.ok(equipItem(state, content, 'fur_cloak').ok);
  assert.ok(equipItem(state, content, 'sword').ok);
  assert.equal(state.player.equipped.clothing, 'fur_cloak');
  assert.equal(state.player.equipped.weapon, 'sword');
  assert.deepEqual(equipItem(state, content, 'wood'), { ok: false, reason: 'not_equippable' });
  assert.deepEqual(equipItem(state, content, 'bow'), { ok: false, reason: 'not_in_inventory' });
});

test('failed actions never advance time and the state stays valid', () => {
  const { state, content } = newGame();
  const t = state.tick;
  for (const a of [
    { type: 'craft', recipe: 'sword' },
    { type: 'build', structure: 'shelter' },
    { type: 'use', item: 'bread' },
    { type: 'equip', item: 'sword' },
    { type: 'rest', ticks: 0 },
  ] as const) {
    assert.equal(perform(state, content, a).ok, false);
  }
  assert.equal(state.tick, t);
  assert.deepEqual(checkInvariants(state, content), []);
});
