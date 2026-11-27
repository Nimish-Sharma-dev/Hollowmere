import type { ContentBundle, Id } from '../../shared/src/index.ts';
import { buildStructure, craftRecipe, equipItem, useItem } from './crafting.ts';
import { gatherNode } from './gathering.ts';
import { fail } from './state.ts';
import type { GameState, Result } from './state.ts';
import { advance } from './world.ts';

export type Action =
  | { type: 'wait'; ticks: number }
  | { type: 'rest'; ticks: number }
  | { type: 'gather'; node: Id }
  | { type: 'craft'; recipe: Id }
  | { type: 'use'; item: Id }
  | { type: 'equip'; item: Id }
  | { type: 'build'; structure: Id }
  | { type: 'near'; tags: string[] };

const DEFAULT_TICKS = { gather: 2, use: 1, equip: 0, build: 4 } as const;

/** Apply one player action and advance time by its cost. Failed actions cost no time. */
export function perform(state: GameState, content: ContentBundle, action: Action): Result<{ ticks: number }> {
  if (!state.player.alive) return fail('player_dead');
  switch (action.type) {
    case 'wait':
    case 'rest': {
      if (!Number.isInteger(action.ticks) || action.ticks < 1) return fail('bad_ticks');
      advance(state, content, action.ticks, action.type === 'rest' ? 'rest' : 'idle');
      return { ok: true, ticks: action.ticks };
    }
    case 'near':
      state.player.nearby = [...new Set(action.tags)].sort();
      return { ok: true, ticks: 0 };
    case 'gather': {
      const r = gatherNode(state, content, action.node);
      if (!r.ok) return r;
      const ticks = content.nodes[state.nodes[action.node]!.def]?.ticks ?? DEFAULT_TICKS.gather;
      advance(state, content, ticks, 'work');
      return { ok: true, ticks };
    }
    case 'craft': {
      const r = craftRecipe(state, content, action.recipe);
      if (!r.ok) return r;
      advance(state, content, r.ticks, 'work');
      return { ok: true, ticks: r.ticks };
    }
    case 'use': {
      const r = useItem(state, content, action.item);
      if (!r.ok) return r;
      advance(state, content, DEFAULT_TICKS.use, 'normal');
      return { ok: true, ticks: DEFAULT_TICKS.use };
    }
    case 'equip': {
      const r = equipItem(state, content, action.item);
      if (!r.ok) return r;
      return { ok: true, ticks: DEFAULT_TICKS.equip };
    }
    case 'build': {
      const r = buildStructure(state, content, action.structure);
      if (!r.ok) return r;
      advance(state, content, DEFAULT_TICKS.build, 'work');
      return { ok: true, ticks: DEFAULT_TICKS.build };
    }
  }
}
