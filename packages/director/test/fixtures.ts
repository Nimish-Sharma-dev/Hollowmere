import { loadContent } from '../../content/src/loader.ts';
import { join } from 'node:path';
import { makeLore } from '../src/lore.ts';
import { buildFallbackBible } from '../src/bible.ts';
import type { RunBible } from '../src/bible.ts';
import { createGame } from '../../engine/src/state.ts';
import type { GameState } from '../../engine/src/state.ts';
import { startGameFromBible } from '../src/runtime.ts';
import { PROMPT_FIXTURES, sampleVars } from '../src/fixtures.ts';

export const DATA_DIR = join(import.meta.dirname, '..', '..', 'content', 'data');
export const content = loadContent(DATA_DIR);
export const lore = makeLore();

export function newBible(seed = 1): RunBible {
  return buildFallbackBible(content, lore, { seed }).bible;
}
export function newState(seed = 1): { state: GameState; bible: RunBible } {
  const bible = newBible(seed);
  return { state: startGameFromBible(content, lore, bible, seed), bible };
}
export const bareState = (seed = 1): GameState => createGame(content, { seed });

export { sampleVars };
export const OUTPUT_FIXTURES = PROMPT_FIXTURES;
