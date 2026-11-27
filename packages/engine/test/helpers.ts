import { createGame } from '../src/index.ts';
import type { GameState, NewGameOptions } from '../src/index.ts';
import type { ContentBundle } from '../../shared/src/index.ts';
import { makeContent, SIM_NODES } from './fixtures/content.ts';

export function newGame(overrides: Partial<NewGameOptions> = {}, content: ContentBundle = makeContent()): { state: GameState; content: ContentBundle } {
  const state = createGame(content, {
    seed: 42,
    nodes: SIM_NODES,
    startItems: [
      { item: 'axe', qty: 1 },
      { item: 'pickaxe', qty: 1 },
    ],
    ...overrides,
  });
  return { state, content };
}

/** tick at which `day` (1-indexed) starts */
export const dayStart = (day: number): number => (day - 1) * 240;
