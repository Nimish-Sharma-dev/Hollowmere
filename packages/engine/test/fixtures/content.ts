import type { ContentBundle, ItemDef, NpcCard } from '../../../shared/src/index.ts';

/**
 * TEST FIXTURES ONLY. This is not the content lane (packages/content, T010).
 * It is a small, valid ContentBundle so the engine can be tested without the real library.
 */
export function makeContent(): ContentBundle {
  const items: ItemDef[] = [
    { id: 'wood', name: 'Wood', kind: 'resource', stack: 20 },
    { id: 'stone', name: 'Stone', kind: 'resource', stack: 20 },
    { id: 'iron_ore', name: 'Iron Ore', kind: 'resource', stack: 20 },
    { id: 'hide', name: 'Hide', kind: 'resource', stack: 10 },
    { id: 'arrow', name: 'Arrow', kind: 'resource', stack: 30 },
    { id: 'berries', name: 'Berries', kind: 'food', stack: 20, food: { hunger: 8 } },
    { id: 'raw_meat', name: 'Raw Meat', kind: 'resource', stack: 10 },
    { id: 'cooked_meat', name: 'Cooked Meat', kind: 'food', stack: 10, food: { hunger: 28, health: 2 } },
    { id: 'bread', name: 'Bread', kind: 'food', stack: 10, food: { hunger: 22 } },
    { id: 'bandage', name: 'Bandage', kind: 'remedy', stack: 5, remedy: { heal: 25 } },
    { id: 'axe', name: 'Axe', kind: 'tool', stack: 1, tool: { type: 'axe', power: 2 } },
    { id: 'pickaxe', name: 'Pickaxe', kind: 'tool', stack: 1, tool: { type: 'pickaxe', power: 1 } },
    { id: 'sword', name: 'Sword', kind: 'weapon', stack: 1, weapon: { damage: 14, range: 1.6, cooldown: 8, knockback: 0.6 } },
    { id: 'bow', name: 'Bow', kind: 'weapon', stack: 1, weapon: { damage: 9, range: 7, cooldown: 14, knockback: 0.2, ranged: { ammo: 'arrow' } } },
    { id: 'wool_coat', name: 'Wool Coat', kind: 'clothing', stack: 1, warmth: 5 },
    { id: 'fur_cloak', name: 'Fur Cloak', kind: 'clothing', stack: 1, warmth: 8 },
  ];
  const npc = (id: string, name: string, roles: string[], home: string, work: string, gather: string): NpcCard => ({ id, name, allowedRoles: roles, home, work, gather });
  const npcs = [
    npc('maren', 'Maren', ['friend', 'rival', 'smuggler', 'protector'], 'home_maren', 'forge', 'meeting_hall'),
    npc('tobin', 'Tobin', ['victim', 'liar', 'keeper'], 'home_tobin', 'mill', 'well'),
    npc('edda', 'Sister Edda', ['saint', 'cult_leader', 'griever'], 'home_edda', 'chapel', 'chapel'),
    npc('voss', 'Captain Voss', ['hero', 'coward', 'tyrant'], 'home_voss', 'watchtower', 'meeting_hall'),
    npc('pip', 'Pip', ['truth_seer', 'thief', 'hope'], 'home_pip', 'village_gate', 'well'),
    npc('wren', 'Wren', ['guide', 'spy', 'leaver'], 'home_wren', 'forest_edge', 'forest_edge'),
    npc('alder', 'Mayor Alder', ['weary_leader', 'hoarder', 'traitor'], 'home_alder', 'meeting_hall', 'meeting_hall'),
    npc('bram', 'Bram', ['ally_trader', 'swindler', 'impostor'], 'village_gate', 'village_gate', 'well'),
  ];
  const locations = ['forge', 'mill', 'chapel', 'watchtower', 'meeting_hall', 'farm', 'forest_edge', 'village_gate', 'well', 'home_maren', 'home_tobin', 'home_edda', 'home_voss', 'home_pip', 'home_wren', 'home_alder'];

  return {
    items: Object.fromEntries(items.map((i) => [i.id, i])),
    recipes: {
      cooked_meat: { id: 'cooked_meat', output: { item: 'cooked_meat', qty: 1 }, inputs: [{ item: 'raw_meat', qty: 1 }], station: 'fire', ticks: 2 },
      arrow: { id: 'arrow', output: { item: 'arrow', qty: 4 }, inputs: [{ item: 'wood', qty: 1 }, { item: 'stone', qty: 1 }], station: 'workshop', ticks: 2 },
      fur_cloak: { id: 'fur_cloak', output: { item: 'fur_cloak', qty: 1 }, inputs: [{ item: 'hide', qty: 4 }], station: 'workshop', ticks: 6 },
      axe: { id: 'axe', output: { item: 'axe', qty: 1 }, inputs: [{ item: 'wood', qty: 2 }, { item: 'stone', qty: 2 }], ticks: 3 },
      sword: { id: 'sword', output: { item: 'sword', qty: 1 }, inputs: [{ item: 'iron_ore', qty: 3 }, { item: 'wood', qty: 1 }], station: 'workshop', ticks: 8 },
    },
    nodes: {
      oak_tree: { id: 'oak_tree', name: 'Oak Tree', yields: [{ item: 'wood', min: 2, max: 4 }], tool: 'axe', uses: 3, respawnDays: 2 },
      berry_bush: { id: 'berry_bush', name: 'Berry Bush', yields: [{ item: 'berries', min: 2, max: 4 }], uses: 4, respawnDays: 1, energyCost: 1 },
      stone_outcrop: { id: 'stone_outcrop', name: 'Stone Outcrop', yields: [{ item: 'stone', min: 1, max: 3 }], tool: 'pickaxe', uses: 5, respawnDays: 3 },
      iron_vein: { id: 'iron_vein', name: 'Iron Vein', yields: [{ item: 'iron_ore', min: 1, max: 2 }], tool: 'pickaxe', uses: 2, respawnDays: 4 },
    },
    enemies: {
      wolf: { id: 'wolf', name: 'Wolf', hp: 36, damage: 9, speed: 0.14, sight: 8, attackRange: 1.2, attackCooldown: 14, fleeBelow: 0.25, drops: [{ item: 'raw_meat', chance: 0.8, min: 1, max: 2 }, { item: 'hide', chance: 0.6, min: 1, max: 1 }] },
      bandit: { id: 'bandit', name: 'Bandit', hp: 60, damage: 12, speed: 0.09, sight: 9, attackRange: 1.4, attackCooldown: 18, drops: [{ item: 'bread', chance: 0.4, min: 1, max: 1 }, { item: 'bandage', chance: 0.2, min: 1, max: 1 }] },
      cultist: { id: 'cultist', name: 'Cultist', hp: 45, damage: 11, speed: 0.1, sight: 9, attackRange: 1.4, attackCooldown: 16, drops: [{ item: 'bandage', chance: 0.3, min: 1, max: 1 }] },
      bear: { id: 'bear', name: 'Bear', hp: 120, damage: 22, speed: 0.1, sight: 7, attackRange: 1.6, attackCooldown: 24, drops: [{ item: 'hide', chance: 1, min: 2, max: 3 }, { item: 'raw_meat', chance: 1, min: 2, max: 3 }] },
    },
    structures: {
      campfire: { id: 'campfire', name: 'Campfire', cost: [{ item: 'wood', qty: 5 }, { item: 'stone', qty: 2 }], provides: 'fire' },
      shelter: { id: 'shelter', name: 'Shelter', cost: [{ item: 'wood', qty: 20 }], provides: 'shelter' },
      workshop: { id: 'workshop', name: 'Workshop', cost: [{ item: 'wood', qty: 10 }, { item: 'stone', qty: 6 }], provides: 'workshop' },
    },
    npcs: Object.fromEntries(npcs.map((n) => [n.id, n])),
    locations,
    events: {
      midnight_theft: {
        id: 'midnight_theft',
        tags: ['crime'],
        slots: { thief: { roles: ['thief', 'swindler', 'hoarder'] }, victim: { roles: ['victim', 'friend', 'weary_leader', 'keeper'] } },
        beats: ['{thief} was seen near {victim}\'s door after dark.', '{victim} says something is missing.'],
        effects: ['village.fear +1', 'npc[thief].trust -2', 'npc[victim].trust +1', 'flag.set theft_reported', 'plant clue stolen_coin'],
        cooldownDays: 3,
      },
      hoard_found: {
        id: 'hoard_found',
        tags: ['secret'],
        requirements: { minDay: 2, flagsNone: ['hoard_found'] },
        slots: { hoarder: { roles: ['hoarder', 'traitor', 'swindler'] } },
        beats: ['Sacks of grain are found in {hoarder}\'s cellar.'],
        effects: ['village.trust -2', 'village.hope -1', 'start dilemma confront_hoarder', 'flag.set hoard_found'],
      },
      bread_gift: {
        id: 'bread_gift',
        tags: ['kindness'],
        slots: { giver: { roles: ['friend', 'saint', 'protector', 'hero'] } },
        beats: ['{giver} leaves a warm loaf on your doorstep.'],
        effects: ['village.hope +1', 'npc[giver].trust +2', 'give item bread 2'],
        cooldownDays: 2,
      },
      night_watch: {
        id: 'night_watch',
        tags: ['night'],
        requirements: { phase: ['night'] },
        slots: { guard: { roles: ['hero', 'coward', 'tyrant', 'weary_leader', 'protector'] } },
        beats: ['{guard} doubles the watch tonight.'],
        effects: ['village.fear +0.5'],
      },
      rival_challenge: {
        id: 'rival_challenge',
        tags: ['conflict'],
        requirements: { minDay: 2 },
        slots: { challenger: { roles: ['rival', 'tyrant', 'coward'] }, witness: { roles: ['friend', 'truth_seer', 'hope', 'protector'] } },
        beats: ['{challenger} confronts you in the square while {witness} watches.'],
        effects: ['village.unity -0.5', 'npc[challenger].trust -1', 'npc[witness].trust +1'],
        cooldownDays: 4,
      },
      false_prophet: {
        id: 'false_prophet',
        tags: ['belief'],
        requirements: { minDay: 3 },
        slots: { preacher: { roles: ['cult_leader', 'saint', 'griever', 'hero'] }, follower: { roles: ['hope', 'victim', 'liar'] } },
        beats: ['{preacher} speaks of salvation, and {follower} kneels to listen.'],
        effects: ['village.hope +0.5', 'village.unity -0.5', 'plant clue sermon_words'],
        cooldownDays: 4,
      },
      bad_bargain: {
        id: 'bad_bargain',
        tags: ['trade'],
        requirements: { minDay: 2 },
        slots: { dealer: { roles: ['ally_trader', 'swindler', 'impostor', 'smuggler'] }, customer: { roles: ['friend', 'hope', 'victim', 'keeper'] } },
        beats: ['{dealer} presses a bargain on {customer}, too quickly.'],
        effects: ['village.trust -0.5', 'npc[dealer].trust -1', 'plant clue odd_prices'],
        cooldownDays: 3,
      },
      contradicting_story: {
        id: 'contradicting_story',
        tags: ['mystery'],
        requirements: { minDay: 2 },
        slots: { speaker: { roles: ['liar', 'traitor', 'impostor'] }, listener: { roles: ['truth_seer', 'keeper', 'weary_leader'] } },
        beats: ['{speaker} tells {listener} a story that does not match yesterday\'s.'],
        effects: ['npc[speaker].trust -1', 'plant clue two_stories'],
        cooldownDays: 3,
      },
      stranger_at_the_gate: {
        id: 'stranger_at_the_gate',
        tags: ['mystery'],
        slots: { watcher: { roles: ['spy', 'guide', 'leaver', 'truth_seer'] }, intruder: { roles: ['impostor', 'swindler', 'smuggler', 'thief'] } },
        beats: ['{watcher} notices {intruder} near the gate after dark.', '{intruder} claims to be passing through.'],
        effects: ['village.fear +0.5', 'npc[watcher].trust +1', 'plant clue gate_stranger'],
        cooldownDays: 4,
      },
      festival: { id: 'festival', tags: ['threshold'], slots: {}, beats: ['Lanterns line the square.'], effects: ['village.hope +1', 'village.unity +1'], cooldownDays: 5 },
      riot: { id: 'riot', tags: ['threshold'], slots: {}, beats: ['Shouting spills out of the meeting hall.'], effects: ['village.unity -2', 'village.fear -1'], cooldownDays: 5 },
      famine: { id: 'famine', tags: ['threshold'], slots: {}, beats: ['The grain store is empty.'], effects: ['village.fear +1', 'village.hope -1', 'flag.set famine_seen', 'schedule event soup_kitchen in 1'], cooldownDays: 6 },
      soup_kitchen: {
        id: 'soup_kitchen',
        tags: ['relief'],
        slots: { cook: { roles: ['saint', 'friend', 'protector', 'griever', 'hero'] } },
        beats: ['{cook} opens a soup kitchen in the hall.'],
        effects: ['village.hunger -1.5', 'village.hope +0.5', 'npc[cook].trust +1', 'spawn npc[cook] at meeting_hall'],
      },
      gift_day: { id: 'gift_day', tags: ['threshold'], slots: {}, beats: ['Neighbours bring you small gifts.'], effects: ['village.hope +0.5', 'give item bread 1'], cooldownDays: 5 },
      factions_split: { id: 'factions_split', tags: ['threshold'], slots: {}, beats: ['The village splits into two camps.'], effects: ['village.fear +1', 'flag.set village_split'], cooldownDays: 5 },
      exodus: { id: 'exodus', tags: ['threshold'], slots: {}, beats: ['Carts leave the gate at dawn.'], effects: ['village.hope -1', 'flag.set exodus_begun'] },
    },
    thresholds: [
      { id: 'hope_high', conditions: [{ stat: 'hope', op: '>=', value: 8 }], event: 'festival', cooldownDays: 5 },
      { id: 'fear_high', conditions: [{ stat: 'fear', op: '>=', value: 8 }], event: 'riot', cooldownDays: 5 },
      { id: 'hunger_high', conditions: [{ stat: 'hunger', op: '>=', value: 7 }], event: 'famine', cooldownDays: 6 },
      { id: 'trust_high', conditions: [{ stat: 'trust', op: '>=', value: 8 }], event: 'gift_day', cooldownDays: 5 },
      { id: 'unity_low', conditions: [{ stat: 'unity', op: '<=', value: 2 }], event: 'factions_split', cooldownDays: 5 },
      {
        id: 'everything_low',
        conditions: [
          { stat: 'hope', op: '<=', value: 2 },
          { stat: 'trust', op: '<=', value: 2 },
          { stat: 'unity', op: '<=', value: 2 },
        ],
        event: 'exodus',
        cooldownDays: 99,
        once: true,
      },
    ],
  };
}

export const SIM_NODES = [
  { id: 'oak_01', def: 'oak_tree' },
  { id: 'oak_02', def: 'oak_tree' },
  { id: 'oak_03', def: 'oak_tree' },
  { id: 'bush_01', def: 'berry_bush' },
  { id: 'bush_02', def: 'berry_bush' },
  { id: 'bush_03', def: 'berry_bush' },
  { id: 'stone_01', def: 'stone_outcrop' },
  { id: 'stone_02', def: 'stone_outcrop' },
  { id: 'iron_01', def: 'iron_vein' },
];

export const SIM_START = [
  { item: 'axe', qty: 1 },
  { item: 'pickaxe', qty: 1 },
  { item: 'bread', qty: 6 },
  { item: 'wool_coat', qty: 1 },
];
