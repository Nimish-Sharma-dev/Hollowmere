import type { ContentBundle } from '../../shared/src/index.ts';
import { perform } from './actions.ts';
import type { Action } from './actions.ts';
import { checkInvariants } from './invariants.ts';
import { count } from './inventory.ts';
import { hashState } from './rng.ts';
import { createGame, currentPhase } from './state.ts';
import type { GameState, NewGameOptions } from './state.ts';
import { dayOf } from './time.ts';
import { advance } from './world.ts';

export type Policy = (state: GameState, content: ContentBundle) => Action | null;

/** A small deterministic survival bot: eats, rests, builds, equips, gathers what it needs. */
export const survivalBot: Policy = (state, content) => {
  const p = state.player;
  const phase = currentPhase(state);

  // be at the base (all built stations available) in the evening and at night
  const provided = [...new Set(state.structures.map((s) => content.structures[s.kind]?.provides ?? ''))].filter(Boolean).sort();
  const cold = p.stats.warmth < 60 && provided.includes('fire');
  const desired = phase === 'evening' || phase === 'night' || cold ? provided : [];
  if (JSON.stringify(desired) !== JSON.stringify(p.nearby)) return { type: 'near', tags: desired };

  // warm up at the fire before doing anything else
  if (cold) return { type: 'wait', ticks: 4 };

  // eat
  if (p.stats.hunger < 45) {
    let best: { id: string; v: number } | null = null;
    for (const s of p.inventory.stacks) {
      const f = content.items[s.item]?.food;
      if (f && (!best || f.hunger > best.v)) best = { id: s.item, v: f.hunger };
    }
    if (best) return { type: 'use', item: best.id };
  }

  // rest
  if (p.stats.energy < 25 || (phase === 'night' && p.stats.energy < 70)) return { type: 'rest', ticks: 10 };

  // wear the warmest clothing we hold
  let warmest: { id: string; w: number } | null = null;
  for (const s of p.inventory.stacks) {
    const def = content.items[s.item];
    if (def?.kind === 'clothing' && (!warmest || (def.warmth ?? 0) > warmest.w)) warmest = { id: s.item, w: def.warmth ?? 0 };
  }
  if (warmest && warmest.id !== p.equipped.clothing && (warmest.w > (content.items[p.equipped.clothing ?? '']?.warmth ?? -1))) {
    return { type: 'equip', item: warmest.id };
  }

  // build the cheapest structure we can afford and don't have yet
  const built = new Set(state.structures.map((s) => s.kind));
  const buildable = Object.values(content.structures)
    .filter((d) => !built.has(d.id) && d.cost.every((c) => count(p.inventory, c.item) >= c.qty))
    .sort((a, b) => a.cost.reduce((x, c) => x + c.qty, 0) - b.cost.reduce((x, c) => x + c.qty, 0) || (a.id < b.id ? -1 : 1));
  if (buildable[0]) return { type: 'build', structure: buildable[0].id };

  // cook / craft food when the station is here
  for (const r of Object.values(content.recipes).sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (!content.items[r.output.item]?.food) continue;
    if (r.station && !p.nearby.includes(r.station)) continue;
    if (r.inputs.every((i) => count(p.inventory, i.item) >= i.qty)) return { type: 'craft', recipe: r.id };
  }

  // gather something useful; skip full-pile resources
  if (p.inventory.stacks.length < p.inventory.slots) {
    const ids = Object.keys(state.nodes).sort();
    const options: string[] = [];
    for (const id of ids) {
      const n = state.nodes[id]!;
      const def = content.nodes[n.def]!;
      if (n.usesLeft <= 0) continue;
      if (def.tool && !p.inventory.stacks.some((s) => content.items[s.item]?.tool?.type === def.tool)) continue;
      if (def.yields.every((y) => count(p.inventory, y.item) >= 40)) continue;
      options.push(id);
    }
    if (options.length > 0) return { type: 'gather', node: options[Math.floor(state.tick / 2) % options.length]! };
  }
  return null;
};

export interface SimOptions extends NewGameOptions {
  days: number;
  policy?: Policy;
}

export interface SimResult {
  state: GameState;
  /** state hash recorded at the first action boundary of each new day */
  dayHashes: string[];
  finalHash: string;
  violations: string[];
  actions: number;
  failedActions: number;
  deathDay: number | null;
}

/** Run a whole game with no graphics and no LLM. Fully determined by (content, options). */
export function runHeadless(content: ContentBundle, opts: SimOptions): SimResult {
  const state = createGame(content, opts);
  const policy = opts.policy ?? survivalBot;
  const endTick = opts.days * 240;
  const dayHashes: string[] = [];
  const violations: string[] = [];
  let lastDay = 1;
  let actions = 0;
  let failedActions = 0;
  let deathDay: number | null = null;

  while (state.tick < endTick) {
    if (state.player.alive) {
      const a = policy(state, content);
      const res = a ? perform(state, content, a) : { ok: false as const, reason: 'no_action' };
      actions += 1;
      if (!res.ok) {
        failedActions += 1;
        advance(state, content, 1, 'idle');
      }
    } else {
      if (deathDay === null) deathDay = dayOf(state.tick);
      advance(state, content, 1, 'idle');
    }
    if (!state.player.alive && deathDay === null) deathDay = dayOf(state.tick);
    for (const v of checkInvariants(state, content)) violations.push(`tick ${state.tick}: ${v}`);
    if (dayOf(state.tick) > lastDay) {
      lastDay = dayOf(state.tick);
      dayHashes.push(hashState(state));
    }
    if (violations.length > 20) break;
  }
  return { state, dayHashes, finalHash: hashState(state), violations, actions, failedActions, deathDay };
}
